from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    Body,
    Depends,
    Header,
    UploadFile,
    File,
    Form,
)
import asyncio
import functools
import logging
import yaml
import re
import time
from datetime import datetime
from typing import Optional, List
from pathlib import Path
from email.utils import parsedate_to_datetime
from collections import defaultdict
from backend.services.google_mail_service import (
    send_reply,
    update_thread_labels,
    trash_thread,
    send_new_message,
    send_new_message_with_attachments,
)
from backend.services.imap_mail_sync_service import imap_sync_service
from backend.services.vault_mail_sync_service import sync_service
from backend.services.workspace_service import get_workspace_context
from backend.services.context_vars import get_active_vault_path
from backend.services.contacts_service import ContactsService
from backend.data.management_db import get_mgmt_db
from backend.models.mail import (
    MailView,
    MailViewCreateSchema,
    MailViewUpdateSchema,
)
from backend.data.db import get_db
from sqlalchemy.orm import Session
import json

router = APIRouter(
    prefix="/api/mail", tags=["mail"], dependencies=[Depends(get_workspace_context)]
)
log = logging.getLogger(__name__)


# ── Mail Message Cache ──────────────────────────────────────────────────────────
_MAIL_CACHE: dict = {}
_MAIL_CACHE_TTL = 120  # seconds


def _cache_key(email: str, folder: Optional[str], category: Optional[str]) -> str:
    return f"{email}|{folder or ''}|{category or ''}"


def _get_cached_messages(email: str, folder: Optional[str], category: Optional[str]) -> Optional[list]:
    key = _cache_key(email, folder, category)
    entry = _MAIL_CACHE.get(key)
    if entry and time.time() < entry["expiry"]:
        return entry["messages"]
    return None


def _set_cached_messages(email: str, folder: Optional[str], category: Optional[str], messages: list):
    key = _cache_key(email, folder, category)
    _MAIL_CACHE[key] = {
        "messages": messages,
        "expiry": time.time() + _MAIL_CACHE_TTL,
    }


def _invalidate_mail_cache():
    _MAIL_CACHE.clear()
    _COUNTS_CACHE.clear()


# Els paths s'han de resoldre dinàmicament per cada petició
def get_mail_vault_path() -> Path:
    return get_active_vault_path() / "Mail"


def get_vault_path() -> Path:
    return get_active_vault_path()


def _sanitize_yaml_string(val: str) -> str:
    """Escape problematic characters to make a string safe for YAML.

    The sync service sometimes generates metadata values that already
    contain double quotes (for example the sender field often looks like
    ``"Name" <email@example.com>``).  ``yaml.dump`` wraps the entire value
    in quotes but does not escape inner quotes, leading to invalid YAML like
    ``sender: ""Name" <...>"`` which crashes the parser.  We keep a very
    simple heuristic here: escape every double quote with a backslash so the
    dumper produces a valid quoted string.
    """
    return val.replace('"', '\\"')


def _naive_metadata_from_text(yaml_text: str) -> dict:
    """Parse a YAML-like block using a very forgiving line-by-line strategy.

    This is only used when ``yaml.safe_load`` fails; we don't need to handle
    recursion or complex structures since the mail frontmatter is flat.
    """
    out = {}
    for line in yaml_text.splitlines():
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        cleaned = val.strip().strip('"').strip("'")
        out[key.strip()] = cleaned
    return out


def _repair_file(file_path: Path, yaml_text: str, body: str):
    """Attempt to rewrite a mailbox file with safe frontmatter.

    ``yaml_text`` is the raw text of the frontmatter (between the ``---``
    markers) and ``body`` is the remainder.  We build a metadata dict using
    ``_naive_metadata_from_text`` so we don't depend on the broken YAML, then
    sanitize and dump it back to disk.  This makes the file parseable on
    subsequent reads and prevents the same error from being logged repeatedly.
    """
    metadata = _naive_metadata_from_text(yaml_text)
    # escape every string value so the dumper won't blow up again
    for k, v in list(metadata.items()):
        if isinstance(v, str):
            metadata[k] = _sanitize_yaml_string(v)
    new_front = yaml.dump(
        metadata, default_flow_style=False, sort_keys=False, allow_unicode=True
    )
    file_path.write_text(f"---\n{new_front}---\n\n{body}\n", encoding="utf-8")
    log.info(f"Rewrote malformed mail frontmatter in {file_path}")


def parse_frontmatter(content: str, file_path: Optional[Path] = None):
    """Parses a markdown file to extract YAML frontmatter and body.

    ``file_path`` is optional and only used to provide context in logs.
    In the mail subsystem we log at DEBUG level because malformed frontmatter
    is expected occasionally when emails contain stray YAML-like content.
    """
    match = re.search(r"^---\s*\r?\n(.*?)\r?\n---\s*\r?\n(.*)", content, re.DOTALL)
    if not match:
        match = re.search(r"^---\s*\n(.*?)\n---\s*\n(.*)", content, re.DOTALL)

    if match:
        try:
            metadata = yaml.safe_load(match.group(1)) or {}
            body = match.group(2)
            return metadata, body
        except Exception as e:
            location = f" in {file_path}" if file_path else ""
            log.debug(f"Error parsing mail frontmatter{location}: {e}")
            # try to repair the file contents so future reads succeed
            if file_path:
                try:
                    _repair_file(file_path, match.group(1), match.group(2))
                    # after rewriting the file we can safely parse again and return
                    fixed = file_path.read_text(encoding="utf-8")
                    return parse_frontmatter(fixed, file_path)
                except Exception as rerr:
                    log.debug(f"Failed to repair {file_path}: {rerr}")

    return {}, content


def get_unix_timestamp(date_str):
    """Converts a date string to a Unix timestamp (seconds)."""
    if not date_str:
        return int(time.time())
    try:
        # Try email format (RFC 2822)
        dt = parsedate_to_datetime(str(date_str))
        return int(dt.timestamp())
    except Exception:
        try:
            # If it's a YAML datetime object
            if isinstance(date_str, datetime):
                return int(date_str.timestamp())
        except Exception:
            pass
    return int(time.time())


_COUNTS_CACHE: dict = {}
_COUNTS_CACHE_TTL = 300  # seconds


@router.get("/counts")
async def get_mail_counts(email: str = Query(...)):
    """Returns unread and total counts per folder/category via Gmail API or IMAP."""
    cached = _COUNTS_CACHE.get(email)
    if cached and time.time() < cached["expiry"]:
        return cached["data"]

    from backend.services.hybrid_mail_service import gmail_get_counts, imap_get_counts
    from backend.services.integration_manager import integration_manager

    integrations = integration_manager.get_all_safe()
    all_accounts = integrations.get("emails", []) + integrations.get("mail_accounts", [])
    acc = next((a for a in all_accounts if (a.get("email") or a.get("username")) == email), None)

    loop = asyncio.get_event_loop()
    if acc and acc.get("provider") == "google":
        counts = await loop.run_in_executor(None, gmail_get_counts, email)
    else:
        counts = await loop.run_in_executor(None, imap_get_counts, email)

    _COUNTS_CACHE[email] = {"data": counts, "expiry": time.time() + _COUNTS_CACHE_TTL}
    return counts


@router.get("/messages")
async def get_messages(
    email: str = Query("ismigar@gmail.com"),
    folder: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    limit: int = Query(50),
    offset: int = Query(0),
    page_token: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    """Hybrid: consulta Gmail API o IMAP directament (sense vault)."""
    from backend.services.hybrid_mail_service import gmail_list_messages, imap_list_messages
    from backend.services.integration_manager import integration_manager

    cache_key = f"{email}|{folder}|{category}|{page_token}|{offset}|{search}"
    cached = _MAIL_CACHE.get(cache_key)
    if cached and time.time() < cached["expiry"]:
        return cached["data"]

    integrations = integration_manager.get_all_safe()
    all_accounts = integrations.get("emails", []) + integrations.get("mail_accounts", [])
    acc = next((a for a in all_accounts if (a.get("email") or a.get("username")) == email), None)

    loop = asyncio.get_event_loop()
    if acc and acc.get("provider") == "google":
        result = await loop.run_in_executor(
            None, functools.partial(
                gmail_list_messages, email,
                folder=folder or "all", category=category,
                search=search, limit=limit, page_token=page_token,
            )
        )
    else:
        result = await loop.run_in_executor(
            None, functools.partial(
                imap_list_messages, email,
                folder=folder or "INBOX",
                search=search, limit=limit, offset=offset,
            )
        )

    data = {
        "messages": result.get("messages", []),
        "next_page_token": result.get("next_page_token"),
        "total": result.get("total", len(result.get("messages", []))),
    }
    _MAIL_CACHE[cache_key] = {"data": data, "expiry": time.time() + _MAIL_CACHE_TTL}
    return data


@router.get("/messages/{message_id}")
async def get_message(
    message_id: str,
    email: Optional[str] = Query(None),
    folder: Optional[str] = Query(None),
):
    """Hybrid: obté el detall d'un missatge de Gmail API o IMAP."""
    from backend.services.hybrid_mail_service import gmail_get_message, imap_get_message
    from backend.services.integration_manager import integration_manager

    if email:
        integrations = integration_manager.get_all_safe()
        all_accounts = integrations.get("emails", []) + integrations.get("mail_accounts", [])
        acc = next((a for a in all_accounts if (a.get("email") or a.get("username")) == email), None)

        loop = asyncio.get_event_loop()
        if message_id.startswith("imap_"):
            uid = message_id[5:]
            result = await loop.run_in_executor(None, imap_get_message, email, uid, folder or "INBOX")
        elif acc and acc.get("provider") == "google":
            result = await loop.run_in_executor(None, gmail_get_message, email, message_id)
        else:
            uid = message_id[5:] if message_id.startswith("imap_") else message_id
            result = await loop.run_in_executor(None, imap_get_message, email, uid, folder or "INBOX")

        if result:
            return result

    # Fallback: cerca al vault (missatges guardats manualment)
    mail_path = get_mail_vault_path()
    files = list(mail_path.glob(f"{message_id}_*.md"))
    if not files:
        files = [f for f in mail_path.glob("*.md") if message_id in f.stem]
    if not files:
        raise HTTPException(status_code=404, detail="Message not found")

    file_path = files[0]
    content = file_path.read_text(encoding="utf-8")
    metadata, body = parse_frontmatter(content, file_path)
    html_path = file_path.with_suffix(".html")
    body_html = html_path.read_text(encoding="utf-8") if html_path.exists() else None
    date_val = metadata.get("date")
    return {
        "id": metadata.get("id") or message_id,
        "thread_id": metadata.get("thread_id") or message_id,
        "subject": metadata.get("title") or "Untitled",
        "sender": metadata.get("sender") or "Unknown",
        "recipient": metadata.get("recipients") or "",
        "cc": metadata.get("cc") or "",
        "bcc": metadata.get("bcc") or "",
        "date": str(date_val) if date_val else "",
        "timestamp": get_unix_timestamp(date_val),
        "body_text": body or "",
        "body_html": body_html,
        "is_read": metadata.get("is_read", False),
        "is_starred": metadata.get("is_starred", False),
        "has_attachments": metadata.get("has_attachments", False),
        "archived": metadata.get("archived", False),
        "category": metadata.get("category", "Main"),
        "type": metadata.get("type", "Received"),
        "account": metadata.get("account", ""),
        "source": "vault",
    }


@router.post("/sync")
async def sync_mail_accounts(email: Optional[str] = Query(None), limit: int = 50):
    """Triggers a manual synchronization for one or all mail accounts."""
    try:
        from backend.services.integration_manager import integration_manager

        integrations = integration_manager.get_all_safe()

        # If email is provided, sync only that one. Otherwise, sync all.
        accounts_to_sync = []
        if email:
            accounts_to_sync.append(email)
        else:
            # Get all gmail/google accounts from integrations
            for acc in integrations.get("mail_accounts", []):
                acc_email = acc.get("email") or acc.get("username")
                if acc_email:
                    accounts_to_sync.append(acc_email)

            # Also check generic emails list if any
            for acc in integrations.get("emails", []):
                if acc.get("email"):
                    accounts_to_sync.append(acc["email"])

        # Deduplicate
        accounts_to_sync = list(set(accounts_to_sync))

        total_synced = 0
        for acc_email in accounts_to_sync:
            log.info(f"Triggering manual sync for {acc_email}...")
            # Check account type to decide which sync service to use
            acc_data = integration_manager.get_raw("mail_accounts")
            account_info = next(
                (
                    acc
                    for acc in acc_data
                    if acc.get("email") == acc_email or acc.get("username") == acc_email
                ),
                None,
            )
            if account_info and account_info.get("provider") == "manual":
                # Use IMAP sync service
                from backend.services.imap_mail_sync_service import imap_sync_service

                count = imap_sync_service.sync_account(acc_email, limit=limit)
            else:
                # Use Gmail sync service
                count = sync_service.sync_emails(acc_email, limit=limit)
            total_synced += count

        return {
            "status": "success",
            "synced_count": total_synced,
            "accounts": accounts_to_sync,
        }
    except Exception as e:
        log.error(f"Error in POST /api/mail/sync: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/messages/{message_id}")
async def update_message(message_id: str, update: dict = Body(...)):
    """Updates metadata fields in Vault and propagates flag changes to IMAP server."""
    mail_path = get_mail_vault_path()
    files = list(mail_path.glob(f"{message_id}_*.md"))
    if not files:
        files = [f for f in mail_path.glob("*.md") if message_id in f.stem]
    if not files:
        raise HTTPException(status_code=404, detail="Message not found")

    file_path = files[0]
    content = file_path.read_text(encoding="utf-8")
    metadata, body = parse_frontmatter(content, file_path)

    allowed_fields = {"is_read", "is_starred", "snoozed_until", "category"}
    for key, value in update.items():
        if key in allowed_fields:
            metadata[key] = value

    new_front = yaml.dump(
        metadata, default_flow_style=False, sort_keys=False, allow_unicode=True
    )
    file_path.write_text(f"---\n{new_front}---\n\n{body}\n", encoding="utf-8")

    _invalidate_mail_cache()

    # Propagate flag changes to IMAP server
    account_email = metadata.get("account", "")
    if account_email and _is_imap_account(account_email):
        from backend.services.imap_mail_sync_service import imap_sync_service
        if "is_read" in update:
            imap_sync_service.mark_read(account_email, message_id, update["is_read"])
        if "is_starred" in update:
            imap_sync_service.star_message(account_email, message_id, update["is_starred"])

    return {"status": "success"}


def _is_imap_account(email: str) -> bool:
    from backend.services.integration_manager import integration_manager
    accs = integration_manager.get_raw("mail_accounts")
    acc = next((a for a in accs if a.get("email") == email), None)
    return bool(acc and acc.get("provider") == "manual" and acc.get("imap_host"))


def _resolve_gmail_id(message_id: str) -> str:
    """Returns thread_id from vault if available, otherwise the message_id as-is."""
    mail_path = get_mail_vault_path()
    files = list(mail_path.glob(f"{message_id}_*.md"))
    if not files:
        files = [f for f in mail_path.glob("*.md") if message_id in f.stem]
    if files:
        try:
            content = files[0].read_text(encoding="utf-8")
            meta, _ = parse_frontmatter(content, files[0])
            return meta.get("thread_id") or message_id
        except Exception:
            pass
    return message_id


@router.post("/messages/{message_id}/trash")
async def trash_msg(message_id: str, email: str = Query(...)):
    if _is_imap_account(email):
        from backend.services.imap_mail_sync_service import imap_sync_service
        if imap_sync_service.trash_message(email, message_id):
            _invalidate_mail_cache()
            return {"status": "success"}
    gmail_id = _resolve_gmail_id(message_id)
    if trash_thread(email, gmail_id):
        _invalidate_mail_cache()
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Error trashing message")


@router.post("/messages/{message_id}/archive")
async def archive_msg(message_id: str, email: str = Query(...)):
    if _is_imap_account(email):
        from backend.services.imap_mail_sync_service import imap_sync_service
        if imap_sync_service.archive_message(email, message_id):
            _invalidate_mail_cache()
            return {"status": "success"}
    gmail_id = _resolve_gmail_id(message_id)
    if update_thread_labels(email, gmail_id, remove_labels=["INBOX"]):
        _invalidate_mail_cache()
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Error archiving message")


@router.post("/messages/{message_id}/star")
async def star_msg(
    message_id: str, email: str = Query(...), starred: bool = Body(..., embed=True)
):
    if _is_imap_account(email):
        from backend.services.imap_mail_sync_service import imap_sync_service
        if imap_sync_service.star_message(email, message_id, starred):
            _invalidate_mail_cache()
            return {"status": "success"}
    gmail_id = _resolve_gmail_id(message_id)
    if starred:
        success = update_thread_labels(email, gmail_id, add_labels=["STARRED"])
    else:
        success = update_thread_labels(email, gmail_id, remove_labels=["STARRED"])
    if success:
        _invalidate_mail_cache()
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Error updating star")
    

@router.post("/messages/{message_id}/spam")
async def spam_msg(message_id: str, email: str = Query(...), spam: bool = Body(..., embed=True)):
    """Marca o desmarca un missatge com a spam (correu brossa)."""
    if _is_imap_account(email):
        from backend.services.imap_mail_sync_service import imap_sync_service
        # IMAP: Movem a la carpeta de spam o a INBOX
        folders = imap_sync_service.list_folders(email)
        spam_folder = next((f["name"] for f in folders if f["type"] == "Spam"), "Junk")
        target = spam_folder if spam else "INBOX"
        if imap_sync_service.move_message(email, message_id, target):
            _invalidate_mail_cache()
            return {"status": "success"}
    else:
        # Gmail: Afegim/treiem l'etiqueta SPAM
        gmail_id = _resolve_gmail_id(message_id)
        if spam:
            success = update_thread_labels(email, gmail_id, add_labels=["SPAM"], remove_labels=["INBOX"])
        else:
            success = update_thread_labels(email, gmail_id, add_labels=["INBOX"], remove_labels=["SPAM"])
        if success:
            _invalidate_mail_cache()
            return {"status": "success"}
            
    raise HTTPException(status_code=500, detail="Error actualitzant estat de spam")


@router.post("/empty_folder")
async def empty_folder(email: str = Query(...), folder: str = Query(...)):
    """Buida una carpeta (Paperera o Spam)."""
    log.info(f"[Mail] Peticion buidat carpeta {folder} per a {email}")
    if _is_imap_account(email):
        from backend.services.imap_mail_sync_service import imap_sync_service
        folders = imap_sync_service.list_folders(email)
        
        # Resolve real folder name and type
        folder_info = None
        # Try exact match first
        folder_info = next((f for f in folders if f["name"] == folder), None)
        # If not found, try logical type match (TRASH -> Deleted, SPAM -> Spam)
        if not folder_info:
            target_type = "Deleted" if folder.upper() == "TRASH" else "Spam" if folder.upper() == "SPAM" else None
            if target_type:
                folder_info = next((f for f in folders if f["type"] == target_type), None)
        
        if not folder_info:
            log.warning(f"[IMAP] Carpeta {folder} no trobada per a {email}")
            raise HTTPException(status_code=404, detail=f"Folder {folder} not found")
            
        real_name = folder_info["name"]
        is_trash = folder_info["type"] == "Deleted" or real_name.upper() == "TRASH"
        log.info(f"[IMAP] Buidant carpeta real '{real_name}' (permanent={is_trash})")
        
        if imap_sync_service.empty_folder(email, real_name, permanent=is_trash):
            _invalidate_mail_cache()
            return {"status": "success"}
    else:
        # Gmail logic
        from backend.services.google_mail_service import get_gmail_service
        service = get_gmail_service(email)
        if service:
            try:
                # Find messages in this folder
                q = "in:trash" if folder.upper() == "TRASH" else "in:spam" if folder.upper() == "SPAM" else None
                log.info(f"[Gmail] Cercant missatges amb query '{q}' per a {email}")
                if q:
                    results = service.users().messages().list(userId="me", q=q, includeSpamTrash=True).execute()
                    messages = results.get("messages", [])
                    log.info(f"[Gmail] Trobats {len(messages)} missatges")
                    if messages:
                        ids = [m["id"] for m in messages]
                        if folder.upper() == "TRASH":
                            # Permanent delete
                            service.users().messages().batchDelete(userId="me", body={"ids": ids}).execute()
                            log.info(f"[Gmail] batchDelete executat per {len(ids)} ids")
                        else:
                            # Move to trash (remove SPAM label, add TRASH)
                            service.users().messages().batchModify(userId="me", body={
                                "ids": ids,
                                "addLabelIds": ["TRASH"],
                                "removeLabelIds": ["SPAM"]
                            }).execute()
                            log.info(f"[Gmail] batchModify executat per {len(ids)} ids")
                    _invalidate_mail_cache()
                    return {"status": "success"}
            except Exception as e:
                log.error(f"[Gmail] Error buidant carpeta {folder}: {e}")
                if "insufficientPermissions" in str(e) or "403" in str(e):
                    # Forcem un missatge més clar de "Reconnectar"
                    raise HTTPException(
                        status_code=403, 
                        detail="L'aplicació necessita nous permisos per buidar carpetes. Si us plau, ves a Configuració i torna a connectar el teu compte de Gmail."
                    )
                raise HTTPException(status_code=500, detail=f"Error Gmail: {str(e)}")

    raise HTTPException(status_code=500, detail="Error buidant la carpeta")


@router.post("/drafts")
async def save_draft(payload: dict = Body(...)):
    """Auto-saves a draft to the Vault. Creates or overwrites {draft_id}.md with type: Draft."""
    import uuid as _uuid

    draft_id = payload.get("draft_id") or f"draft_{_uuid.uuid4().hex[:12]}"
    to = payload.get("to", "")
    cc = payload.get("cc", "")
    bcc = payload.get("bcc", "")
    subject = payload.get("subject", "")
    body = payload.get("body", "")
    email_account = payload.get("account", "")

    mail_path = get_mail_vault_path()
    mail_path.mkdir(parents=True, exist_ok=True)

    clean = "".join(c for c in subject if c.isalnum() or c in (" ", "-", "_")).strip()[
        :50
    ]
    filename = f"{draft_id}_{clean}.md" if clean else f"{draft_id}.md"

    # Remove previous draft file with same draft_id (subject may have changed)
    for old in mail_path.glob(f"{draft_id}_*.md"):
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
        "date": datetime.utcnow().isoformat(),
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
    yaml_front = yaml.dump(
        metadata, default_flow_style=False, sort_keys=False, allow_unicode=True
    )
    file_path = mail_path / filename
    file_path.write_text(f"---\n{yaml_front}---\n\n{body}\n", encoding="utf-8")
    return {"status": "success", "draft_id": draft_id}


@router.get("/recipients/suggest")
async def suggest_recipients(
    q: str = Query(default=""),
    email: Optional[str] = Query(default=None),
    x_workspace_id: str = Header(default="personal", alias="X-Workspace-ID"),
    mgmt_db: Session = Depends(get_mgmt_db),
):
    """Returns recipient suggestions combining:
    1. App contacts matching the query
    2. Frequent co-recipients from sent mail (group suggestions)
    3. Previous individual recipients from sent mail
    """
    q_lower = q.strip().lower()
    seen_emails = set()

    # --- 1. Scan sent mail for past recipients ---
    mail_path = get_mail_vault_path()
    recipient_freq: dict = defaultdict(int)
    # co_recipients[email] → list of emails sent together with it
    co_map: dict = defaultdict(set)

    if mail_path.exists():
        for fp in mail_path.glob("*.md"):
            try:
                content = fp.read_text(encoding="utf-8")
                meta, _ = parse_frontmatter(content, fp)
                if meta.get("type") != "Sent":
                    continue
                if meta.get("account") and meta["account"] != email:
                    continue
                raw_to = str(meta.get("recipients") or "")
                raw_cc = str(meta.get("cc") or "")
                addrs = [
                    a.strip()
                    for a in re.split(r"[,;]", raw_to + "," + raw_cc)
                    if a.strip()
                ]
                emails_in_thread = set()
                for addr in addrs:
                    # extract bare email from "Name <email>" or plain email
                    m = re.search(r"<([^>]+)>", addr)
                    bare = m.group(1).strip() if m else addr.strip()
                    if "@" not in bare:
                        continue
                    bare = bare.lower()
                    recipient_freq[bare] += 1
                    emails_in_thread.add(bare)
                # build co-recipient map
                for e in emails_in_thread:
                    co_map[e].update(emails_in_thread - {e})
            except Exception:
                pass

    # --- 2. Query contacts DB ---
    contacts_matched = []
    try:
        service = ContactsService(mgmt_db, x_workspace_id)
        contacts = service.list_contacts(search=q or None)
        for c in contacts:
            primary = (c.email or "").strip()
            candidates = [primary] if primary else []
            try:
                extra = json.loads(c.emails) if isinstance(c.emails, str) else (c.emails or [])
                for entry in extra:
                    addr = (entry.get("value") or entry.get("email") or "").strip()
                    if addr and addr not in candidates:
                        candidates.append(addr)
            except Exception:
                pass
            for e in candidates:
                e_lower = e.lower()
                if e_lower not in seen_emails:
                    seen_emails.add(e_lower)
                    contacts_matched.append({
                        "email": e,
                        "name": c.name or "",
                        "source": "contacts",
                        "freq": recipient_freq.get(e_lower, 0),
                    })
    except Exception as ex:
        log.warning(f"Could not query contacts: {ex}")

    # --- 3. Build sent-history suggestions ---
    history_matched = []
    for addr, freq in sorted(recipient_freq.items(), key=lambda x: -x[1]):
        if addr in seen_emails:
            continue
        if q_lower and q_lower not in addr:
            continue
        seen_emails.add(addr)
        history_matched.append(
            {
                "email": addr,
                "name": "",
                "source": "history",
                "freq": freq,
            }
        )

    # Merge and filter by query
    all_candidates = contacts_matched + history_matched
    if q_lower:
        all_candidates = [
            c
            for c in all_candidates
            if q_lower in c["email"].lower() or q_lower in c["name"].lower()
        ]

    # Sort: contacts with freq first, then history by freq
    all_candidates.sort(
        key=lambda c: (-c["freq"], 0 if c["source"] == "contacts" else 1)
    )

    # --- 4. Group suggestions: co-recipients of the first match ---
    group_suggestions = []
    if all_candidates:
        first_email = all_candidates[0]["email"].lower()
        co_emails = list(co_map.get(first_email, set()))[:5]
        for ce in co_emails:
            if ce not in seen_emails:
                group_suggestions.append(
                    {
                        "email": ce,
                        "name": "",
                        "source": "group",
                        "freq": recipient_freq.get(ce, 0),
                    }
                )

    return {
        "suggestions": all_candidates[:8],
        "group_suggestions": group_suggestions,
    }


@router.post("/send")
async def send_mail(
    email: str = Query(...),
    to: str = Form(None),
    subject: str = Form(default=""),
    body: str = Form(default=""),
    cc: str = Form(default=None),
    bcc: str = Form(default=None),
    attachments: List[UploadFile] = File(default=[]),
):
    # Support both multipart/form-data (with attachments) and plain JSON
    if to is None:
        raise HTTPException(status_code=400, detail="Missing TO")
    if not body:
        raise HTTPException(status_code=400, detail="Missing BODY")

    attachment_data = []
    for f in attachments:
        content = await f.read()
        attachment_data.append(
            {
                "filename": f.filename,
                "content_type": f.content_type or "application/octet-stream",
                "data": content,
            }
        )

    if attachment_data:
        success = send_new_message_with_attachments(
            email, to, subject, body, cc, bcc, attachment_data
        )
    else:
        success = send_new_message(email, to, subject, body, cc, bcc)

    if success:
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Error sending email")


@router.get("/folders")
async def get_folders(email: str = Query(...)):
    """Returns available IMAP folders for an account."""
    if not _is_imap_account(email):
        # Gmail: return standard label-based folders
        return {"folders": [
            {"name": "INBOX", "type": "Received"},
            {"name": "SENT", "type": "Sent"},
            {"name": "TRASH", "type": "Deleted"},
            {"name": "SPAM", "type": "Spam"},
            {"name": "DRAFTS", "type": "Draft"},
        ]}
    from backend.services.imap_mail_sync_service import imap_sync_service
    folders = imap_sync_service.list_folders(email)
    return {"folders": folders}


@router.post("/messages/{message_id}/move")
async def move_message(message_id: str, email: str = Query(...), payload: dict = Body(...)):
    """Move a message to a different folder."""
    target_folder = payload.get("target_folder")
    if not target_folder:
        raise HTTPException(status_code=400, detail="Missing target_folder")

    if not _is_imap_account(email):
        raise HTTPException(status_code=400, detail="Move only supported for IMAP accounts")

    from backend.services.imap_mail_sync_service import imap_sync_service
    ok = imap_sync_service.move_message(email, message_id, target_folder)
    if ok:
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Error moving message")


@router.post("/batch")
async def batch_action(email: str = Query(...), payload: dict = Body(...)):
    action = payload.get("action")  # 'trash', 'archive', 'read', 'star'
    ids = payload.get("ids", [])

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

    _COUNTS_CACHE.pop(email, None)
    return {"status": "success", "processed": success_count}


@router.post("/messages/{message_id}/read")
async def mark_as_read(message_id: str, email: str = Query(...)):
    """Marca un missatge com a llegit (treu l'etiqueta UNREAD a Gmail o posa \\Seen a IMAP)."""
    if _is_imap_account(email):
        from backend.services.imap_mail_sync_service import imap_sync_service
        uid = message_id[5:] if message_id.startswith("imap_") else message_id
        if imap_sync_service.mark_read(email, uid, True):
            _invalidate_mail_cache()
            return {"status": "success"}
    gmail_id = _resolve_gmail_id(message_id)
    if update_thread_labels(email, gmail_id, remove_labels=["UNREAD"]):
        _invalidate_mail_cache()
        return {"status": "success"}
    return {"status": "success"}  # no error si no hi ha vault file


@router.post("/messages/{message_id}/snooze")
async def snooze_message(message_id: str, payload: dict = Body(...)):
    """Saves a snoozed_until timestamp in the message's Vault markdown file."""
    snooze_until = payload.get("snooze_until")
    if not snooze_until:
        raise HTTPException(status_code=400, detail="Missing snooze_until")

    mail_path = get_mail_vault_path()
    files = list(mail_path.glob(f"{message_id}_*.md"))
    if not files:
        files = [f for f in mail_path.glob("*.md") if message_id in f.stem]
    if not files:
        raise HTTPException(status_code=404, detail="Message not found")

    file_path = files[0]
    content = file_path.read_text(encoding="utf-8")
    metadata, body = parse_frontmatter(content, file_path)
    metadata["snoozed_until"] = snooze_until

    new_front = yaml.dump(
        metadata, default_flow_style=False, sort_keys=False, allow_unicode=True
    )
    file_path.write_text(f"---\n{new_front}---\n\n{body}\n", encoding="utf-8")
    return {"status": "success"}


@router.post("/messages/{message_id}/reply")
async def reply_message(
    message_id: str,
    email: str = Query(...),
    body: str = Form(...),
    to: Optional[str] = Form(default=None),
    cc: Optional[str] = Form(default=None),
    bcc: Optional[str] = Form(default=None),
    attachments: List[UploadFile] = File(default=[]),
):
    att_list = []
    for att in attachments:
        data = await att.read()
        att_list.append({"filename": att.filename, "data": data, "content_type": att.content_type})

    success = send_reply(
        email=email,
        thread_id=message_id,
        body=body,
        to_recipients=to,
        cc_recipients=cc,
        bcc_recipients=bcc,
        attachments=att_list if att_list else None,
    )
    if success:
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Error sending email")


@router.post("/ai/generate_draft")
async def generate_draft(payload: dict = Body(...)):
    from pipeline.ai_client import call_ai_with_fallback

    context = payload.get("context", "")
    instruction = payload.get("prompt", "Write a professional response.")
    ai_prompt = f"Context: {context}\nInstruction: {instruction}\nRespond only with the email body in English."
    content, provider = call_ai_with_fallback(ai_prompt)
    return {"draft": content, "provider": provider}


@router.post("/ai/extract_entities")
async def extract_entities(payload: dict = Body(...)):
    from pipeline.ai_client import call_ai_with_fallback
    import json

    context = payload.get("context", "")
    if not context:
        return {"events": [], "contacts": []}

    system_prompt = """Extract potential calendar events and contacts from the following email.
Return ONLY a JSON object with 'events' and 'contacts' arrays. 
If no entities are found, return empty arrays.

Events should have:
- title: string
- start: ISO datetime string (if only date is mentioned, use T09:00:00)
- end: ISO datetime string (if not mentioned, 1 hour after start)
- location: string
- description: string

Contacts should have:
- name: string
- email: string
- phone: string
- company: string
- notes: string

EMAIL CONTENT:
"""
    ai_prompt = system_prompt + context
    content, provider = call_ai_with_fallback(ai_prompt)
    
    try:
        clean_content = content.strip()
        if clean_content.startswith("```json"):
            clean_content = clean_content[7:-3].strip()
        elif clean_content.startswith("```"):
            clean_content = clean_content[3:-3].strip()
            
        data = json.loads(clean_content)
        return {
            "events": data.get("events", []),
            "contacts": data.get("contacts", []),
            "provider": provider
        }
    except Exception as e:
        log.error(f"Error parsing AI response for entities: {e}")
        return {"events": [], "contacts": [], "error": str(e), "raw": content}



# ── Mail Views CRUD ─────────────────────────────────────────────────────────────

def _view_to_dict(view: MailView) -> dict:
    return {
        "id": view.id,
        "name": view.name,
        "fields": json.loads(view.fields or "[]"),
        "filters": json.loads(view.filters or "[]"),
        "filter_logic": view.filter_logic,
        "group_by": view.group_by,
        "sort_by": view.sort_by,
        "sort_dir": view.sort_dir,
        "actions": json.loads(view.actions or "[]"),
        "created_at": view.created_at.isoformat() if view.created_at else None,
        "updated_at": view.updated_at.isoformat() if view.updated_at else None,
    }


@router.get("/views")
async def list_views(db: Session = Depends(get_db)):
    views = db.query(MailView).order_by(MailView.created_at).all()
    return [_view_to_dict(v) for v in views]


@router.post("/views", status_code=201)
async def create_view(payload: MailViewCreateSchema, db: Session = Depends(get_db)):
    view = MailView(
        name=payload.name,
        fields=json.dumps([f.model_dump() for f in payload.fields]),
        filters=json.dumps([f.model_dump() for f in payload.filters]),
        filter_logic=payload.filter_logic,
        group_by=payload.group_by,
        sort_by=payload.sort_by,
        sort_dir=payload.sort_dir,
        actions=json.dumps(payload.actions),
    )
    db.add(view)
    db.commit()
    db.refresh(view)
    return _view_to_dict(view)


@router.put("/views/{view_id}")
async def update_view(
    view_id: str, payload: MailViewUpdateSchema, db: Session = Depends(get_db)
):
    view = db.query(MailView).filter(MailView.id == view_id).first()
    if not view:
        raise HTTPException(status_code=404, detail="Vista no trobada")
    if payload.name is not None:
        view.name = payload.name
    view.fields = json.dumps([f.model_dump() for f in payload.fields])
    view.filters = json.dumps([f.model_dump() for f in payload.filters])
    view.filter_logic = payload.filter_logic
    view.group_by = payload.group_by
    view.sort_by = payload.sort_by
    view.sort_dir = payload.sort_dir
    view.actions = json.dumps(payload.actions)
    db.commit()
    db.refresh(view)
    return _view_to_dict(view)


@router.delete("/views/{view_id}", status_code=204)
async def delete_view(view_id: str, db: Session = Depends(get_db)):
    view = db.query(MailView).filter(MailView.id == view_id).first()
    if not view:
        raise HTTPException(status_code=404, detail="Vista no trobada")
    db.delete(view)
    db.commit()
