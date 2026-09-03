"""Canonical mail compose."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, List, Optional, cast

import yaml
from fastapi import Depends, File, Form, Header, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from backend.data.management_db import get_mgmt_db
from backend.domains.mail import schemas as mail_schemas
from backend.domains.mail.cache import (
    _COUNTS_CACHE,
    _invalidate_mail_cache,
)
from backend.domains.mail.repositories.vault import (
    _find_message_files,
    _validate_message_id,
    get_mail_vault_path,
    parse_frontmatter,
)
from backend.domains.mail.routing import router
from backend.domains.mail.services.accounts import (
    _is_imap_account,
    _is_microsoft_account,
    _resolve_gmail_id,
)
from backend.domains.mail.services.analysis import analyze_mail_entities
from backend.domains.mail.services.attachments import _embed_quoted_cid_images
from backend.services.contacts_service import ContactsService
from backend.services.google_mail_service import (
    send_new_message,
    send_new_message_with_attachments,
    send_reply,
    trash_thread,
    update_thread_labels,
)
from backend.services.imap_mail_sync_service import imap_sync_service
from backend.services.mail_inline_images import (
    MimeAsset,
    extract_vault_inline_images,
)
from backend.services.workspace_service import require_role
from backend.utils.errors import safe_error_detail
from backend.utils.safe_io import safe_write_text

log = logging.getLogger(__name__)


@router.post(
    "/drafts",
    response_model=mail_schemas.MailDraftSaveResponse,
    response_model_exclude_unset=True,
)
async def save_draft(payload: mail_schemas.MailDraftSaveRequest) -> Any:
    """Auto-saves a draft.

    For IMAP accounts (including Google via XOAUTH2), performs `IMAP APPEND` to the
    server's Drafts folder (e.g. `[Gmail]/Drafts`) with the
    `\\Draft` flag, so it shows up in Gmail/Outlook web. The local vault is kept
    as a cache for immediate visibility and as a fallback if APPEND
    fails (e.g. expired token or offline).

    For accounts without IMAP (should never happen after the
    migration, but just in case), it's only saved to the vault.

    """
    from backend.services.integration_manager import integration_manager

    draft_id = payload.draft_id or None
    prev_imap_uid = payload.imap_uid or None
    to = payload.to
    cc = payload.cc
    bcc = payload.bcc
    subject = payload.subject
    body = payload.body
    email_account = payload.account

    acc = integration_manager.get_mail_account(email_account) if email_account else None

    # APPEND to IMAP/Drafts if the account allows it
    new_imap_uid = None
    if acc and integration_manager.is_imap_account(acc):
        from backend.services.imap_mail_sync_service import imap_sync_service

        try:
            new_imap_uid = await asyncio.to_thread(
                imap_sync_service.append_draft,
                email_account,
                to,
                subject,
                body,
                cc=cc,
                bcc=bcc,
                replace_uid=prev_imap_uid,
            )
        except Exception as e:
            log.warning(
                f"[Drafts] IMAP APPEND failed for {email_account}: {e}; continuing in the vault."
            )

    # Vault local (cache + fallback)
    import uuid as _uuid

    draft_id = draft_id or f"draft_{_uuid.uuid4().hex[:12]}"
    mail_path = get_mail_vault_path()
    mail_path.mkdir(parents=True, exist_ok=True)
    clean = "".join(c for c in subject if c.isalnum() or c in (" ", "-", "_")).strip()[:50]
    filename = f"{draft_id}_{clean}.md" if clean else f"{draft_id}.md"
    for old in list(mail_path.glob(f"{draft_id}_*.md")) + list(mail_path.glob(f"{draft_id}.md")):
        old.unlink(missing_ok=True)
    metadata = {
        "title": subject or "(Esborrany)",
        "id": draft_id,
        "gmail_id": draft_id,
        "thread_id": draft_id,
        "type": "Draft",
        "sender": email_account,
        "recipients": to,
        "cc": cc,
        "bcc": bcc,
        "date": datetime.now(timezone.utc).isoformat(),
        "is_read": True,
        "is_starred": False,
        "has_attachments": False,
        "has_html": False,
        "category": "Main",
        "archived": False,
        "spam": False,
        "account": email_account,
        "database_table_id": "mail",
    }
    if new_imap_uid:
        metadata["imap_uid"] = new_imap_uid
    yaml_front = yaml.dump(metadata, default_flow_style=False, sort_keys=False, allow_unicode=True)
    safe_write_text(mail_path / filename, f"---\n{yaml_front}---\n\n{body}\n")
    _invalidate_mail_cache()
    return {
        "status": "success",
        "draft_id": draft_id,
        "imap_uid": new_imap_uid,
    }


@router.delete(
    "/drafts/{draft_id}",
    response_model=mail_schemas.MailStatusResponse,
    dependencies=[Depends(require_role("editor"))],
)
async def delete_draft(draft_id: str) -> Any:
    # Validate draft_id (same allow-list as message_id) before glob.
    draft_id = _validate_message_id(draft_id)
    mail_path = get_mail_vault_path()
    deleted = False
    for f in list(mail_path.glob(f"{draft_id}_*.md")) + list(mail_path.glob(f"{draft_id}.md")):
        f.unlink(missing_ok=True)
        deleted = True
    _invalidate_mail_cache()
    return {"status": "deleted" if deleted else "not_found"}


def _sent_recipient_history(
    account_email: str | None,
) -> tuple[dict[str, int], dict[str, set[str]]]:
    recipient_freq: dict[str, int] = defaultdict(int)
    co_map: dict[str, set[str]] = defaultdict(set)
    mail_path = get_mail_vault_path()
    if not mail_path.exists():
        return recipient_freq, co_map
    for file_path in mail_path.glob("*.md"):
        try:
            metadata, _ = parse_frontmatter(file_path.read_text(encoding="utf-8"), file_path)
            if metadata.get("type") != "Sent":
                continue
            if metadata.get("account") and metadata["account"] != account_email:
                continue
            raw_addresses = f"{metadata.get('recipients') or ''},{metadata.get('cc') or ''}"
            addresses = [item.strip() for item in re.split(r"[,;]", raw_addresses) if item.strip()]
            thread_emails: set[str] = set()
            for address in addresses:
                match = re.search(r"<([^>]+)>", address)
                bare = (match.group(1) if match else address).strip().lower()
                if "@" in bare:
                    recipient_freq[bare] += 1
                    thread_emails.add(bare)
            for bare in thread_emails:
                co_map[bare].update(thread_emails - {bare})
        except Exception:
            pass
    return recipient_freq, co_map


def _contact_suggestions(
    database: Session,
    workspace_id: str,
    query: str,
    recipient_freq: dict[str, int],
) -> tuple[list[dict[str, Any]], set[str]]:
    suggestions: list[dict[str, Any]] = []
    seen: set[str] = set()
    try:
        contacts = ContactsService(database, workspace_id).list_contacts(search=query or None)
        for contact in contacts:
            primary = str(contact.email or "").strip()
            candidates = [primary] if primary else []
            try:
                raw_extra: Any = (
                    json.loads(contact.emails)
                    if isinstance(contact.emails, str)
                    else contact.emails or []
                )
                for entry in cast(list[Any], raw_extra):
                    address = str(entry.get("value") or entry.get("email") or "").strip()
                    if address and address not in candidates:
                        candidates.append(address)
            except Exception:
                pass
            for address in candidates:
                normalized = address.lower()
                if normalized in seen:
                    continue
                seen.add(normalized)
                suggestions.append(
                    {
                        "email": address,
                        "name": contact.name or "",
                        "source": "contacts",
                        "freq": recipient_freq.get(normalized, 0),
                    }
                )
    except Exception as exc:
        log.warning(f"Could not query contacts: {exc}")
    return suggestions, seen


def _history_suggestions(
    query: str, recipient_freq: dict[str, int], seen: set[str]
) -> list[dict[str, Any]]:
    suggestions: list[dict[str, Any]] = []
    for address, frequency in sorted(recipient_freq.items(), key=lambda item: -item[1]):
        if address in seen or (query and query not in address):
            continue
        seen.add(address)
        suggestions.append({"email": address, "name": "", "source": "history", "freq": frequency})
    return suggestions


def _group_suggestions(
    candidates: list[dict[str, Any]],
    co_map: dict[str, set[str]],
    recipient_freq: dict[str, int],
    seen: set[str],
) -> list[dict[str, Any]]:
    if not candidates:
        return []
    first_email = str(candidates[0]["email"]).lower()
    return [
        {
            "email": address,
            "name": "",
            "source": "group",
            "freq": recipient_freq.get(address, 0),
        }
        for address in list(co_map.get(first_email, set()))[:5]
        if address not in seen
    ]


@router.get(
    "/recipients/suggest",
    response_model=mail_schemas.MailRecipientSuggestionsResponse,
    response_model_exclude_unset=True,
)
async def suggest_recipients(
    q: str = Query(default=""),
    email: Optional[str] = Query(default=None),
    x_workspace_id: str = Header(default="personal", alias="X-Workspace-ID"),
    mgmt_db: Session = Depends(get_mgmt_db),
) -> Any:
    """Returns recipient suggestions combining:
    1. App contacts matching the query
    2. Frequent co-recipients from sent mail (group suggestions)
    3. Previous individual recipients from sent mail
    """
    query = q.strip().lower()
    recipient_freq, co_map = _sent_recipient_history(email)
    contacts, seen = _contact_suggestions(mgmt_db, x_workspace_id, q, recipient_freq)
    candidates = contacts + _history_suggestions(query, recipient_freq, seen)
    if query:
        candidates = [
            candidate
            for candidate in candidates
            if query in str(candidate["email"]).lower() or query in str(candidate["name"]).lower()
        ]
    candidates.sort(
        key=lambda candidate: (
            -int(candidate["freq"]),
            0 if candidate["source"] == "contacts" else 1,
        )
    )
    return {
        "suggestions": candidates[:8],
        "group_suggestions": _group_suggestions(candidates, co_map, recipient_freq, seen),
    }


@router.post("/send", response_model=mail_schemas.MailStatusResponse)
async def send_mail(
    email: str = Query(...),
    to: str = Form(None),
    subject: str = Form(default=""),
    body: str = Form(default=""),
    cc: str = Form(default=None),
    bcc: str = Form(default=None),
    from_name: str = Form(default=None),
    from_email: str = Form(default=None),
    attachments: List[UploadFile] = File(default=[]),
) -> Any:
    if to is None:
        raise HTTPException(status_code=400, detail="Missing TO")
    if not body:
        raise HTTPException(status_code=400, detail="Missing BODY")

    attachment_data: list[MimeAsset] = []
    for f in attachments:
        content = await f.read()
        attachment_data.append(
            {
                "filename": f.filename or "attachment",
                "content_type": f.content_type or "application/octet-stream",
                "data": content,
            }
        )

    # Images pasted into the composer point to /api/vault/assets/ (URL
    # that only resolves within local Gnosi): they get converted into inline attachments
    # with a Content-ID so the recipient can see them.
    body, inline_images = extract_vault_inline_images(body)
    # Drafts resumed from a reply/forward carry the quoted images as
    # URL /api/mail/.../cid/ (self-contained) — these are also turned into inline parts.
    body = await _embed_quoted_cid_images(email, body, inline_images)

    # Resolve the SMTP account (handles aliases: email may be the alias, smtp_email is the parent)
    from backend.services.integration_manager import integration_manager

    smtp_email = email
    acc = integration_manager.get_mail_account(email)
    if acc is None:
        # Try alias resolution: find the parent account that owns this alias
        acc = integration_manager.get_account_by_alias(email)
        if acc:
            smtp_email = acc.get("email") or acc.get("username") or email

    if _is_microsoft_account(smtp_email):
        from backend.services.microsoft_mail_service import microsoft_send_message

        success = microsoft_send_message(
            smtp_email,
            to,
            subject,
            body,
            cc,
            bcc,
            attachments=attachment_data or None,
            inline_images=inline_images or None,
        )
    elif _is_imap_account(smtp_email):
        from backend.services.imap_mail_sync_service import imap_smtp_send

        imap_acc = acc or integration_manager.get_mail_account(smtp_email) or {}
        success = imap_smtp_send(
            imap_acc,
            to,
            subject,
            body,
            cc,
            bcc,
            attachment_data or None,
            from_email=from_email or email,
            from_name=from_name or imap_acc.get("display_name"),
            inline_images=inline_images or None,
        )
    elif attachment_data or inline_images:
        success = send_new_message_with_attachments(
            smtp_email,
            to,
            subject,
            body,
            cc,
            bcc,
            attachment_data,
            inline_images=inline_images or None,
        )
    else:
        success = send_new_message(smtp_email, to, subject, body, cc, bcc)

    if success:
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Error sending email")


@router.get(
    "/folders",
    response_model=mail_schemas.MailFoldersResponse,
    response_model_exclude_unset=True,
)
async def get_folders(email: str = Query(...)) -> Any:
    """Returns available IMAP folders for an account."""
    if not _is_imap_account(email):
        # Gmail: return standard label-based folders
        return {
            "folders": [
                {"name": "INBOX", "type": "Received"},
                {"name": "SENT", "type": "Sent"},
                {"name": "TRASH", "type": "Deleted"},
                {"name": "SPAM", "type": "Spam"},
                {"name": "DRAFTS", "type": "Draft"},
            ]
        }
    folders = imap_sync_service.list_folders(email)
    return {"folders": folders}


def _move_imap_message(
    email: str, message_id: str, target_folder: str, payload: dict[str, Any]
) -> dict[str, str]:
    imap_uid = payload.get("imap_uid")
    imap_folder = payload.get("imap_folder")
    success = (
        imap_sync_service.move_message_by_uid(email, imap_uid, imap_folder, target_folder)
        if imap_uid and imap_folder
        else imap_sync_service.move_message(email, message_id, target_folder)
    )
    if not success:
        raise HTTPException(status_code=500, detail="Error moving message")
    _invalidate_mail_cache()
    return {"status": "success"}


def _move_gmail_message(email: str, message_id: str, target_folder: str) -> dict[str, str]:
    from backend.services.google_mail_service import get_gmail_service

    gmail_id = _resolve_gmail_id(message_id)
    folder_upper = target_folder.upper()
    service = get_gmail_service(email)
    if not service:
        raise HTTPException(status_code=500, detail="Could not connect to Gmail")
    try:
        if folder_upper == "TRASH":
            try:
                service.users().threads().trash(userId="me", id=gmail_id).execute()
            except Exception:
                service.users().messages().trash(userId="me", id=gmail_id).execute()
        elif folder_upper == "INBOX":
            try:
                service.users().threads().untrash(userId="me", id=gmail_id).execute()
            except Exception:
                service.users().messages().untrash(userId="me", id=gmail_id).execute()
            update_thread_labels(email, gmail_id, add_labels=["INBOX"], remove_labels=["SPAM"])
        elif folder_upper == "SPAM":
            try:
                service.users().threads().modify(
                    userId="me",
                    id=gmail_id,
                    body={"addLabelIds": ["SPAM"], "removeLabelIds": ["INBOX", "TRASH"]},
                ).execute()
            except Exception:
                service.users().messages().modify(
                    userId="me",
                    id=gmail_id,
                    body={"addLabelIds": ["SPAM"], "removeLabelIds": ["INBOX", "TRASH"]},
                ).execute()
        else:
            raise HTTPException(
                status_code=400, detail=f"Unsupported Gmail folder: {target_folder}"
            )
        _invalidate_mail_cache()
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as exc:
        log.error(f"[Gmail] Failed to move {gmail_id} to {target_folder}: {exc}")
        raise HTTPException(status_code=500, detail=f"Could not move the message in Gmail: {exc}")


def _move_microsoft_message(email: str, message_id: str, target_folder: str) -> dict[str, str]:
    from backend.services.microsoft_mail_service import microsoft_move_message

    if not microsoft_move_message(email, message_id, target_folder):
        raise HTTPException(status_code=500, detail="Could not move the message in Microsoft")
    _invalidate_mail_cache()
    return {"status": "success"}


@router.post(
    "/messages/{message_id}/move",
    response_model=mail_schemas.MailStatusResponse,
)
async def move_message(
    message_id: str,
    payload: mail_schemas.MailMoveRequest,
    email: str = Query(...),
) -> Any:
    """Move a message to a different folder (IMAP) or apply label changes (Gmail)."""
    target_folder = payload.target_folder
    if not target_folder:
        raise HTTPException(status_code=400, detail="Missing target_folder")
    payload_values = payload.model_dump(exclude_unset=True)
    from backend.services.integration_manager import integration_manager

    account = integration_manager.get_mail_account(email)
    if account and integration_manager.is_imap_account(account):
        return _move_imap_message(email, message_id, target_folder, payload_values)
    if account and integration_manager.is_google_account(account):
        return _move_gmail_message(email, message_id, target_folder)
    if _is_microsoft_account(email):
        return _move_microsoft_message(email, message_id, target_folder)
    raise HTTPException(status_code=400, detail="Account does not support moving messages")


@router.post("/batch", response_model=mail_schemas.MailBatchResponse)
async def batch_action(
    payload: mail_schemas.MailBatchRequest,
    email: str = Query(...),
) -> Any:
    action = payload.action  # 'trash', 'archive', 'read', 'star'
    ids = payload.ids

    if not action or not ids:
        raise HTTPException(status_code=400, detail="Missing ACTION or IDS")

    success_count = 0
    for msg_id in ids:
        if action == "trash":
            if trash_thread(email, msg_id):
                success_count += 1
        elif action == "archive":
            if update_thread_labels(email, msg_id, remove_labels=["INBOX"]):
                success_count += 1
        elif action == "star":
            if update_thread_labels(email, msg_id, add_labels=["STARRED"]):
                success_count += 1
        elif action == "read":
            # Marking as read is removing 'UNREAD' label
            if update_thread_labels(email, msg_id, remove_labels=["UNREAD"]):
                success_count += 1

    _COUNTS_CACHE.pop(email)
    return {"status": "success", "processed": success_count}


@router.post(
    "/messages/{message_id}/read",
    response_model=mail_schemas.MailStatusResponse,
)
async def mark_as_read(
    message_id: str,
    email: str = Query(...),
    folder: Optional[str] = Query(None),
) -> Any:
    """Marks a message as read (removes UNREAD in Gmail or sets \\Seen in IMAP).

    `folder` is optional. If provided, it's passed to `mark_read` so it
    can apply `\\Seen` on the server even when there's no vault file
    (typical for emails not yet synced to the vault). Without this,
    `mark_read` used to return False and the counts cache wasn't invalidated → the
    sidebar kept showing the old counter.

    """
    if _is_microsoft_account(email):
        from backend.services.microsoft_mail_service import microsoft_mark_read

        if microsoft_mark_read(email, message_id, True):
            _invalidate_mail_cache()
            return {"status": "success"}
    if _is_imap_account(email):
        from backend.services.imap_mail_sync_service import imap_sync_service

        uid = message_id[5:] if message_id.startswith("imap_") else message_id
        if imap_sync_service.mark_read(
            email,
            message_id,
            True,
            imap_uid=uid,
            imap_folder=folder,
        ):
            _invalidate_mail_cache()
            return {"status": "success"}
    gmail_id = _resolve_gmail_id(message_id)
    if update_thread_labels(email, gmail_id, remove_labels=["UNREAD"]):
        _invalidate_mail_cache()
        return {"status": "success"}
    return {"status": "success"}  # not an error if there's no vault file


@router.post(
    "/messages/{message_id}/snooze",
    response_model=mail_schemas.MailStatusResponse,
)
async def snooze_message(
    message_id: str,
    payload: mail_schemas.MailSnoozeRequest,
) -> Any:
    """Saves a snoozed_until timestamp in the message's Vault markdown file."""
    snooze_until = payload.snooze_until
    if not snooze_until:
        raise HTTPException(status_code=400, detail="Missing snooze_until")

    mail_path = get_mail_vault_path()
    files = _find_message_files(mail_path, message_id)
    if not files:
        raise HTTPException(status_code=404, detail="Message not found")

    file_path = files[0]
    content = file_path.read_text(encoding="utf-8")
    metadata, body = parse_frontmatter(content, file_path)
    metadata["snoozed_until"] = snooze_until

    new_front = yaml.dump(metadata, default_flow_style=False, sort_keys=False, allow_unicode=True)
    safe_write_text(file_path, f"---\n{new_front}---\n\n{body}\n")
    return {"status": "success"}


@router.post(
    "/messages/{message_id}/reply",
    response_model=mail_schemas.MailStatusResponse,
)
async def reply_message(
    message_id: str,
    email: str = Query(...),
    folder: str = Query("INBOX"),
    body: str = Form(...),
    to: Optional[str] = Form(default=None),
    cc: Optional[str] = Form(default=None),
    bcc: Optional[str] = Form(default=None),
    attachments: List[UploadFile] = File(default=[]),
) -> Any:
    att_list: list[MimeAsset] = []
    for att in attachments:
        data = await att.read()
        att_list.append(
            {
                "filename": att.filename or "attachment",
                "data": data,
                "content_type": att.content_type or "application/octet-stream",
            }
        )

    # Same conversion as in /send: vault images → inline CID attachments.
    body, inline_images = extract_vault_inline_images(body)
    # The quoted content of a reply/forward references the inline images of the message
    # original (URL /cid/ or raw cid:); they need to be embedded as their own parts
    # so the recipient doesn't get them broken.
    body = await _embed_quoted_cid_images(
        email,
        body,
        inline_images,
        source_message_id=message_id,
        source_folder=folder,
    )

    if _is_microsoft_account(email):
        from backend.services.microsoft_mail_service import microsoft_reply_message

        success = microsoft_reply_message(
            email,
            message_id,
            body,
            cast(str, to),
            cast(str, cc),
            cast(str, bcc),
            attachments=att_list or None,
            inline_images=inline_images or None,
        )
    else:
        success = send_reply(
            email=email,
            thread_id=message_id,
            body=body,
            to_recipients=cast(str, to),
            cc_recipients=cast(str, cc),
            bcc_recipients=cast(str, bcc),
            attachments=att_list or None,
            inline_images=inline_images or None,
        )
    if success:
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Error sending email")


@router.post(
    "/ai/generate_draft",
    response_model=mail_schemas.MailGenerateDraftResponse,
)
async def generate_draft(payload: mail_schemas.MailGenerateDraftRequest) -> Any:
    from pipeline.ai_client import call_ai_with_fallback

    context = payload.context
    instruction = payload.prompt
    ai_prompt = (
        f"Context: {context}\nInstruction: {instruction}\n"
        "Respond only with the email body in English."
    )
    content, provider = call_ai_with_fallback(ai_prompt)
    return {"draft": content, "provider": provider}


@router.post(
    "/ai/extract_entities",
    response_model=mail_schemas.MailExtractEntitiesResponse,
    response_model_exclude_unset=True,
)
async def extract_entities(payload: mail_schemas.MailExtractEntitiesRequest) -> Any:
    return await analyze_mail_entities(
        payload.context,
        sender=payload.sender,
        recipients=tuple(payload.recipients),
        attachments=tuple(payload.attachments),
    )
