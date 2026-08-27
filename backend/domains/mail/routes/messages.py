"""Canonical mail messages."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Optional, cast

import yaml  # type: ignore[import-untyped]
from fastapi import Body, Depends, HTTPException, Query

from backend.domains.mail.cache import (
    _COUNTS_CACHE,
    _MAIL_CACHE,
    _invalidate_mail_cache,
)
from backend.domains.mail.repositories.vault import (
    _find_message_files,
    _load_vault_drafts,
    get_mail_vault_path,
    get_unix_timestamp,
    parse_frontmatter,
)
from backend.domains.mail.routing import router
from backend.domains.mail.services.accounts import _is_imap_account
from backend.services.google_mail_service import (
    get_thread_details,
)
from backend.services.vault_mail_sync_service import sync_service
from backend.services.workspace_service import require_role
from backend.utils.errors import safe_error_detail
from backend.utils.safe_io import safe_write_text

log = logging.getLogger(__name__)


@router.get("/counts")
async def get_mail_counts(email: str = Query(...)) -> Any:
    """Returns unread and total counts per folder/category via IMAP or Microsoft Graph.

    XOAUTH2 migration: Google accounts go through the IMAP path (is_imap_account
    includes Google with refresh_token). Microsoft 365 still uses the Graph API.

    """
    cached = _COUNTS_CACHE.get(email)
    if cached is not None:
        return cached

    from backend.services.hybrid_mail_service import imap_get_counts
    from backend.services.integration_manager import integration_manager

    acc = integration_manager.get_mail_account(email)
    if acc and integration_manager.is_microsoft_account(acc):
        from backend.services.microsoft_mail_service import microsoft_get_counts

        counts = await asyncio.to_thread(microsoft_get_counts, email)
    elif acc and integration_manager.is_imap_account(acc):
        counts = await asyncio.to_thread(imap_get_counts, email)
    else:
        counts = {}

    _COUNTS_CACHE.set(email, counts)
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
    force: bool = Query(False),
) -> Any:
    """Hybrid: query IMAP (Google and manual accounts) or Microsoft Graph directly."""
    from backend.services.hybrid_mail_service import imap_list_messages
    from backend.services.integration_manager import integration_manager

    cache_key = f"{email}|{folder}|{category}|{page_token}|{offset}|{search}"
    if not force:
        cached = _MAIL_CACHE.get(cache_key)
        if cached is not None:
            return cached
    else:
        _MAIL_CACHE.pop(cache_key)

    acc = integration_manager.get_mail_account(email)
    # Hard cap on remote mail listings. IMAP servers in particular can hang
    # for minutes on flaky networks, leaving the HTTP request pending and
    # blocking the frontend tab. 30s aligns with the IMAP socket timeout in
    # imap_mail_sync_service and the axios default on the frontend.
    REMOTE_LIST_TIMEOUT_S = 30
    try:
        if acc and integration_manager.is_microsoft_account(acc):
            from backend.services.microsoft_mail_service import microsoft_list_messages

            result = await asyncio.wait_for(
                asyncio.to_thread(
                    microsoft_list_messages,
                    email,
                    folder=folder or "INBOX",
                    category=cast(str, category),
                    search=cast(str, search),
                    limit=limit,
                    page_token=cast(str, page_token),
                ),
                timeout=REMOTE_LIST_TIMEOUT_S,
            )
        else:
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    imap_list_messages,
                    email,
                    folder=folder or "INBOX",
                    search=search,
                    limit=limit,
                    offset=offset,
                ),
                timeout=REMOTE_LIST_TIMEOUT_S,
            )
    except asyncio.TimeoutError:
        return {
            "messages": [],
            "next_page_token": None,
            "total": 0,
            "error": (
                f"Timeout after {REMOTE_LIST_TIMEOUT_S}s listing mail for "
                f"{email}. The remote server is unreachable or slow."
            ),
        }
    if not (acc and integration_manager.is_microsoft_account(acc)):
        if folder and folder.upper() in ("DRAFTS", "DRAFT"):
            vault_drafts = _load_vault_drafts(email)
            existing_ids = {m.get("id") for m in result.get("messages", [])}
            extra = [d for d in vault_drafts if d["id"] not in existing_ids]
            result = dict(result)
            result["messages"] = extra + result.get("messages", [])

    error = result.get("error")
    data = {
        "messages": result.get("messages", []),
        "next_page_token": result.get("next_page_token"),
        "total": result.get("total", len(result.get("messages", []))),
    }
    if error:
        data["error"] = error
    else:
        # Only cache if there's no error
        _MAIL_CACHE.set(cache_key, data)
    return data


@router.get("/messages/{message_id}")
async def get_message(
    message_id: str,
    email: Optional[str] = Query(None),
    folder: Optional[str] = Query(None),
) -> Any:
    """Hybrid: gets the detail of a message via IMAP or Microsoft Graph.

    All messages carry the `imap_` prefix except Microsoft ones. For
    backward compatibility, if an id arrives without a prefix but the account is
    IMAP, it's interpreted as a bare UID.

    """
    from backend.services.hybrid_mail_service import imap_get_message
    from backend.services.integration_manager import integration_manager

    if email:
        acc = integration_manager.get_mail_account(email)
        if acc and integration_manager.is_microsoft_account(acc):
            from backend.services.microsoft_mail_service import microsoft_get_message

            result = await asyncio.to_thread(microsoft_get_message, email, message_id)
        elif acc and integration_manager.is_imap_account(acc):
            uid = message_id[5:] if message_id.startswith("imap_") else message_id
            result = await asyncio.to_thread(imap_get_message, email, uid, folder or "INBOX")
        else:
            result = None

        if result:
            return result

    # Fallback: search the vault (manually saved messages)
    mail_path = get_mail_vault_path()
    files = _find_message_files(mail_path, message_id)
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


@router.get("/threads/{thread_id}")
async def get_thread(thread_id: str, email: str = Query(...)) -> Any:
    """Returns all messages in a thread.

    For IMAP-OAuth accounts (Gmail via XOAUTH2): uses `X-GM-THRID` searching
    in "All Mail" to group INBOX + SENT from the same thread.
    For Microsoft accounts: for now returns just the single message (not implemented).
    Google accounts without IMAP-OAuth (no refresh_token): falls back to the
    traditional Gmail API.

    """
    from backend.services.integration_manager import integration_manager

    acc = integration_manager.get_mail_account(email)
    if not acc:
        return {"messages": []}

    # IMAP-XOAUTH2 path with X-GM-THRID
    if integration_manager.is_imap_oauth_account(acc):
        from backend.services.imap_mail_sync_service import imap_sync_service

        # If thread_id comes from imap_get_message it's the gm_thrid (numeric)
        # If it comes from an old view it may be a Message-ID, look it up first
        gm_thrid = thread_id
        if not thread_id.isdigit():
            # Not an X-GM-THRID, check whether it's a current UID
            uid_only = thread_id[5:] if thread_id.startswith("imap_") else thread_id
            from backend.services.hybrid_mail_service import imap_get_message

            mail = await asyncio.to_thread(imap_get_message, email, uid_only, "INBOX")
            if mail and mail.get("gm_thrid"):
                gm_thrid = mail["gm_thrid"]
            else:
                # Can't resolve the thread; return only the current message.
                return {"messages": [mail] if mail else []}

        messages = await asyncio.to_thread(
            imap_sync_service.fetch_thread_by_gm_thrid, email, gm_thrid
        )
        return {"messages": messages}

    # Fallback: Gmail API (only if some account still has no refresh_token)
    if acc and integration_manager.is_google_account(acc):
        from backend.services.hybrid_mail_service import _parse_gmail_meta

        thread = await asyncio.to_thread(get_thread_details, email, thread_id)
        if not thread:
            return {"messages": []}
        messages = []
        for msg in thread.get("messages", []):
            try:
                messages.append(_parse_gmail_meta(msg, email))
            except Exception:
                pass
        messages.sort(key=lambda m: m.get("timestamp", 0))
        return {"messages": messages}

    return {"messages": []}


@router.get("/events")
async def mail_events(email: Optional[str] = Query(None)) -> Any:
    """Server-Sent Events stream with IMAP IDLE push notifications.

    The client (frontend) can subscribe via `EventSource` and will receive:
      - `event: new_message` when EXISTS increments on the server
      - `event: message_removed` on EXPUNGE
      - `event: flags_changed` on FETCH (FLAGS ...)
      - `event: ping` every 25s to keep the connection alive

    If `email` is present, the stream filters to only that account.

    """
    from fastapi.responses import StreamingResponse

    from backend.services.imap_idle_service import idle_manager

    sub = idle_manager.subscribe(account_filter=email)

    async def event_generator() -> Any:
        last_ping = time.monotonic()
        try:
            yield "event: ready\ndata: {}\n\n"
            while True:
                # pop_blocking is synchronous; run it in a thread so it doesn't block the loop.
                evt = await asyncio.to_thread(sub.pop_blocking, 5.0)
                if evt:
                    name = evt.get("type", "event")
                    import json as _json

                    payload = _json.dumps(
                        {
                            "account": evt.get("account"),
                            "type": name,
                            "raw": evt.get("raw"),
                        }
                    )
                    yield f"event: {name}\ndata: {payload}\n\n"

                # Heartbeat ping every ~25s so proxies don't cut the connection.
                now = time.monotonic()
                if now - last_ping > 25:
                    yield "event: ping\ndata: {}\n\n"
                    last_ping = now
        except asyncio.CancelledError:
            raise
        finally:
            idle_manager.unsubscribe(sub)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # nginx: deshabilita buffering
        },
    )


@router.post("/sync", dependencies=[Depends(require_role("editor"))])
async def sync_mail_accounts(email: Optional[str] = Query(None), limit: int = 50) -> Any:
    """Triggers a manual synchronization for one or all mail accounts."""
    try:
        from backend.services.imap_mail_sync_service import imap_sync_service
        from backend.services.integration_manager import integration_manager

        all_accounts = integration_manager.get_all_mail_accounts()

        if email:
            accounts_to_sync = [email]
        else:
            seen = set()
            accounts_to_sync = []
            for acc in all_accounts:
                if not acc.get("enabled", True):
                    continue
                addr = acc.get("email") or acc.get("username")
                if addr and addr not in seen:
                    seen.add(addr)
                    accounts_to_sync.append(addr)

        total_synced = 0
        failed_accounts = []
        for acc_email in accounts_to_sync:
            log.info(f"Manual sync for {acc_email}...")
            acc = integration_manager.get_mail_account(acc_email)
            if acc and integration_manager.is_imap_account(acc):
                # Offload the blocking imaplib socket I/O to a worker thread so it
                # doesn't freeze the event loop (and every other request) for the
                # duration of the sync.
                count = await asyncio.to_thread(
                    imap_sync_service.sync_account, acc_email, limit=limit
                )
                if count is None:
                    log.warning(f"[Sync] IMAP connection failed for {acc_email}")
                    failed_accounts.append(acc_email)
                    count = 0
            else:
                count = await asyncio.to_thread(sync_service.sync_emails, acc_email, limit=limit)
            total_synced += count or 0

        if failed_accounts and not total_synced and len(failed_accounts) == len(accounts_to_sync):
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Could not connect: {', '.join(failed_accounts)}. "
                    "Check the IMAP credentials in Settings."
                ),
            )

        return {
            "status": "partial" if failed_accounts else "success",
            "synced_count": total_synced,
            "accounts": accounts_to_sync,
            "failed": failed_accounts,
        }
    except Exception as e:
        log.error(f"Error en POST /api/mail/sync: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /api/mail/sync"),
        )


@router.patch("/messages/{message_id}", dependencies=[Depends(require_role("editor"))])
async def update_message(message_id: str, update: dict[str, Any] = Body(...)) -> Any:
    """Updates metadata fields in Vault and propagates flag changes to IMAP server."""
    mail_path = get_mail_vault_path()
    files = _find_message_files(mail_path, message_id)
    if not files:
        raise HTTPException(status_code=404, detail="Message not found")

    file_path = files[0]
    content = file_path.read_text(encoding="utf-8")
    metadata, body = parse_frontmatter(content, file_path)

    allowed_fields = {"is_read", "is_starred", "snoozed_until", "category"}
    for key, value in update.items():
        if key in allowed_fields:
            metadata[key] = value

    new_front = yaml.dump(metadata, default_flow_style=False, sort_keys=False, allow_unicode=True)
    safe_write_text(file_path, f"---\n{new_front}---\n\n{body}\n")

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
