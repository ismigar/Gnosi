"""Canonical mail actions."""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import Depends, HTTPException, Query

from backend.domains.mail.cache import (
    _invalidate_mail_cache,
)
from backend.domains.mail import schemas as mail_schemas
from backend.domains.mail.routing import router
from backend.domains.mail.services.accounts import (
    _is_imap_account as _is_imap_account,
)
from backend.domains.mail.services.accounts import (
    _is_microsoft_account as _is_microsoft_account,
)
from backend.domains.mail.services.accounts import (
    _resolve_gmail_id as _resolve_gmail_id,
)
from backend.services.google_mail_service import (
    trash_thread,
    update_thread_labels,
)
from backend.services.workspace_service import require_role
from backend.utils.errors import safe_error_detail

log = logging.getLogger(__name__)


@router.post(
    "/messages/{message_id}/trash",
    response_model=mail_schemas.MailStatusResponse,
    dependencies=[Depends(require_role("editor"))],
)
async def trash_msg(
    message_id: str, email: str = Query(...), folder: Optional[str] = Query(None)
) -> Any:
    if _is_imap_account(email):
        from backend.services.imap_mail_sync_service import imap_sync_service

        if imap_sync_service.trash_message(email, message_id, imap_folder=folder):
            _invalidate_mail_cache()
            return {"status": "success"}
    if _is_microsoft_account(email):
        from backend.services.microsoft_mail_service import microsoft_trash_message

        if microsoft_trash_message(email, message_id):
            _invalidate_mail_cache()
            return {"status": "success"}
    gmail_id = _resolve_gmail_id(message_id)
    if trash_thread(email, gmail_id):
        _invalidate_mail_cache()
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Error trashing message")


@router.post(
    "/messages/{message_id}/archive",
    response_model=mail_schemas.MailStatusResponse,
    dependencies=[Depends(require_role("editor"))],
)
async def archive_msg(
    message_id: str, email: str = Query(...), folder: Optional[str] = Query(None)
) -> Any:
    if _is_imap_account(email):
        from backend.services.imap_mail_sync_service import imap_sync_service

        if imap_sync_service.archive_message(email, message_id, imap_folder=folder):
            _invalidate_mail_cache()
            return {"status": "success"}
    gmail_id = _resolve_gmail_id(message_id)
    if update_thread_labels(email, gmail_id, remove_labels=["INBOX"]):
        _invalidate_mail_cache()
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Error archiving message")


@router.post(
    "/messages/{message_id}/star",
    response_model=mail_schemas.MailStatusResponse,
    dependencies=[Depends(require_role("editor"))],
)
async def star_msg(
    message_id: str,
    payload: mail_schemas.MailStarRequest,
    email: str = Query(...),
) -> Any:
    starred = payload.starred
    if _is_microsoft_account(email):
        from backend.services.microsoft_mail_service import microsoft_star_message

        if microsoft_star_message(email, message_id, starred):
            _invalidate_mail_cache()
            return {"status": "success"}
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


@router.post(
    "/messages/{message_id}/spam",
    response_model=mail_schemas.MailStatusResponse,
    dependencies=[Depends(require_role("editor"))],
)
async def spam_msg(
    message_id: str,
    payload: mail_schemas.MailSpamRequest,
    email: str = Query(...),
) -> Any:
    """Marks or unmarks a message as spam (junk mail)."""
    spam = payload.spam
    if _is_imap_account(email):
        from backend.services.imap_mail_sync_service import imap_sync_service

        # IMAP: Move to the spam folder or to INBOX
        folders = imap_sync_service.list_folders(email)
        spam_folder = next((f["name"] for f in folders if f["type"] == "Spam"), "Junk")
        target = spam_folder if spam else "INBOX"
        if imap_sync_service.move_message(email, message_id, target):
            _invalidate_mail_cache()
            return {"status": "success"}
    else:
        # Gmail: Add/remove the SPAM label
        gmail_id = _resolve_gmail_id(message_id)
        if spam:
            success = update_thread_labels(
                email, gmail_id, add_labels=["SPAM"], remove_labels=["INBOX"]
            )
        else:
            success = update_thread_labels(
                email, gmail_id, add_labels=["INBOX"], remove_labels=["SPAM"]
            )
        if success:
            _invalidate_mail_cache()
            return {"status": "success"}

    raise HTTPException(status_code=500, detail="Error updating spam status")


def _resolve_imap_folder(
    email: str, folder: str, folders: list[dict[str, Any]], sync_service: Any
) -> tuple[str, bool]:
    folder_info = next((item for item in folders if item["name"] == folder), None)
    target_type = {"TRASH": "Deleted", "SPAM": "Spam"}.get(folder.upper())
    if not folder_info and target_type:
        folder_info = next((item for item in folders if item["type"] == target_type), None)
    real_name = None
    if not folder_info and target_type:
        keywords = (
            ["trash", "paperera", "papelera", "deleted", "bin", "wastebasket"]
            if folder.upper() == "TRASH"
            else ["spam", "junk", "brossa"]
        )
        raw_folders = sync_service.list_all_raw_folders(email)
        real_name = next(
            (name for keyword in keywords for name in raw_folders if keyword in name.lower()),
            None,
        )
        if real_name:
            log.info(f"[IMAP] Folder found through raw fallback: {real_name}")
    if not folder_info and not real_name:
        if not folders:
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Could not connect to account {email}. Check the IMAP credentials in Settings."
                ),
            )
        raise HTTPException(status_code=404, detail=f"Folder {folder} not found")
    resolved_name = real_name or (folder_info["name"] if folder_info else folder)
    is_trash = bool(folder_info and folder_info["type"] == "Deleted") or folder.upper() == "TRASH"
    return resolved_name, is_trash


def _empty_imap_folder(email: str, folder: str) -> dict[str, str] | None:
    from backend.services.imap_mail_sync_service import imap_sync_service

    folders = imap_sync_service.list_folders(email)
    real_name, is_trash = _resolve_imap_folder(email, folder, folders, imap_sync_service)
    log.info(f"[IMAP] Emptying actual folder '{real_name}' (permanent={is_trash})")
    if not imap_sync_service.empty_folder(email, real_name, permanent=is_trash):
        return None
    _invalidate_mail_cache()
    return {"status": "success"}


def _gmail_folder_query(folder: str) -> str | None:
    return {"TRASH": "in:trash", "SPAM": "in:spam"}.get(folder.upper())


def _empty_gmail_folder(email: str, folder: str) -> dict[str, str] | None:
    from backend.services.google_mail_service import get_gmail_service

    service = get_gmail_service(email)
    if not service:
        return None
    try:
        query = _gmail_folder_query(folder)
        log.info(f"[Gmail] Searching messages with query '{query}' for {email}")
        if not query:
            return None
        results = (
            service.users().messages().list(userId="me", q=query, includeSpamTrash=True).execute()
        )
        ids = [message["id"] for message in results.get("messages", [])]
        if ids and folder.upper() == "TRASH":
            service.users().messages().batchDelete(userId="me", body={"ids": ids}).execute()
        elif ids:
            service.users().messages().batchModify(
                userId="me",
                body={"ids": ids, "addLabelIds": ["TRASH"], "removeLabelIds": ["SPAM"]},
            ).execute()
        _invalidate_mail_cache()
        return {"status": "success"}
    except Exception as exc:
        log.error(f"[Gmail] Failed to empty folder {folder}: {exc}")
        if "insufficientPermissions" in str(exc) or "403" in str(exc):
            raise HTTPException(
                status_code=403,
                detail=(
                    "The application needs new permissions to empty folders. "
                    "Go to Settings and reconnect your Gmail account."
                ),
            )
        raise HTTPException(status_code=500, detail=safe_error_detail(exc, "Gmail empty folder"))


@router.post(
    "/empty_folder",
    response_model=mail_schemas.MailStatusResponse,
    dependencies=[Depends(require_role("admin"))],
)
async def empty_folder(email: str = Query(...), folder: str = Query(...)) -> Any:
    """Empty a folder (Trash or Spam)."""
    log.info(f"[Mail] Folder-empty request for {folder} from {email}")
    result = (
        _empty_imap_folder(email, folder)
        if _is_imap_account(email)
        else _empty_gmail_folder(email, folder)
    )
    if result:
        return result
    raise HTTPException(status_code=500, detail="Could not empty the folder")
