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
from datetime import datetime, timezone
from typing import Optional, List
from pathlib import Path
from email.utils import parsedate_to_datetime
from collections import defaultdict

from backend.utils.safe_io import safe_write_text, safe_write_json
from backend.utils.errors import safe_error_detail
from backend.services.workspace_service import require_role
from backend.services.google_mail_service import (
    send_reply,
    update_thread_labels,
    trash_thread,
    send_new_message,
    send_new_message_with_attachments,
    get_thread_details,
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
    MailTag,
    MailMessageTag,
    MailTagCreateSchema,
    MailTagUpdateSchema,
    MailMessageTagsSetSchema,
)
from backend.data.db import get_db
from sqlalchemy.orm import Session
import json

router = APIRouter(
    prefix="/api/mail", tags=["mail"], dependencies=[Depends(get_workspace_context)]
)
log = logging.getLogger(__name__)


# ── Mail Message Cache ──────────────────────────────────────────────────────────
# Thread-safe + bounded. Replaces the previous bare dict that grew unbounded
# (every (email, folder, category) tuple stayed forever) and could race with
# the threadpool callbacks invoked from `run_in_executor`.
from backend.utils.cache import SimpleCache as _SimpleCache
_MAIL_CACHE = _SimpleCache(default_ttl=120, max_size=128)
_COUNTS_CACHE = _SimpleCache(default_ttl=300, max_size=64)


def _cache_key(email: str, folder: Optional[str], category: Optional[str]) -> str:
    return f"{email}|{folder or ''}|{category or ''}"


def _get_cached_messages(email: str, folder: Optional[str], category: Optional[str]) -> Optional[list]:
    return _MAIL_CACHE.get(_cache_key(email, folder, category))


def _set_cached_messages(email: str, folder: Optional[str], category: Optional[str], messages: list):
    _MAIL_CACHE.set(_cache_key(email, folder, category), messages)


def _invalidate_mail_cache():
    _MAIL_CACHE.clear()
    _COUNTS_CACHE.clear()


# Els paths s'han de resoldre dinàmicament per cada petició
def get_mail_vault_path() -> Path:
    return get_active_vault_path() / "Mail"


def get_vault_path() -> Path:
    return get_active_vault_path()


# Allow-list characters that are safe inside a Mail/ filename stem. Real
# message ids from Gmail/IMAP only ever use these. Anything else (path
# separators, glob wildcards, ".." traversal segments, NUL) is rejected
# before being interpolated into a `glob()` pattern.
_MESSAGE_ID_RE = re.compile(r"^[A-Za-z0-9_\-@.+]+$")


def _validate_message_id(message_id: str) -> str:
    """Validates and returns the message_id, or raises HTTPException(400)."""
    mid = str(message_id or "").strip()
    if not mid or not _MESSAGE_ID_RE.match(mid) or len(mid) > 256:
        raise HTTPException(status_code=400, detail="Invalid message id")
    return mid


def _find_message_files(mail_path: Path, message_id: str) -> list[Path]:
    """Returns mail .md files matching `<message_id>_*.md` or that contain
    the (validated) id in the stem. Validates the id before any glob to
    avoid arbitrary glob patterns landing in user input.
    """
    mid = _validate_message_id(message_id)
    files = list(mail_path.glob(f"{mid}_*.md"))
    if not files:
        files = [f for f in mail_path.glob("*.md") if mid in f.stem]
    return files


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
    safe_write_text(file_path, f"---\n{new_front}---\n\n{body}\n")
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


@router.get("/counts")
async def get_mail_counts(email: str = Query(...)):
    """Returns unread and total counts per folder/category via IMAP or Microsoft Graph.

    Migració XOAUTH2: els comptes Google passen pel camí IMAP (és_imap_account
    inclou Google amb refresh_token). Microsoft 365 segueix per Graph API.
    """
    cached = _COUNTS_CACHE.get(email)
    if cached is not None:
        return cached

    from backend.services.hybrid_mail_service import imap_get_counts
    from backend.services.integration_manager import integration_manager

    acc = integration_manager.get_mail_account(email)
    if integration_manager.is_microsoft_account(acc):
        from backend.services.microsoft_mail_service import microsoft_get_counts
        counts = await asyncio.to_thread(microsoft_get_counts, email)
    elif integration_manager.is_imap_account(acc):
        counts = await asyncio.to_thread(imap_get_counts, email)
    else:
        counts = {}

    _COUNTS_CACHE.set(email, counts)
    return counts


def _load_vault_drafts(account_email: str) -> list:
    """Retorna els esborranys guardats localment al vault per un compte IMAP."""
    mail_path = get_mail_vault_path()
    if not mail_path.exists():
        return []
    drafts = []
    for f in mail_path.glob("draft_*.md"):
        try:
            content = f.read_text(encoding="utf-8")
            metadata, body = parse_frontmatter(content, f)
            if metadata.get("type") != "Draft":
                continue
            if account_email and metadata.get("account", "") != account_email:
                continue
            date_val = metadata.get("date")
            drafts.append({
                "id": metadata.get("id") or f.stem,
                "thread_id": metadata.get("thread_id") or f.stem,
                "subject": metadata.get("title") or "(Esborrany)",
                "sender": metadata.get("sender") or account_email,
                "recipient": metadata.get("recipients") or "",
                "cc": metadata.get("cc") or "",
                "date": str(date_val) if date_val else "",
                "timestamp": get_unix_timestamp(date_val) if date_val else 0,
                "body_text": body or "",
                "is_read": True,
                "is_starred": False,
                "has_attachments": False,
                "archived": False,
                "type": "Draft",
                "account": account_email,
                "source": "vault",
            })
        except Exception:
            continue
    drafts.sort(key=lambda d: d.get("timestamp", 0), reverse=True)
    return drafts


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
):
    """Hybrid: consulta IMAP (Google+manuals) o Microsoft Graph directament."""
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
        if integration_manager.is_microsoft_account(acc):
            from backend.services.microsoft_mail_service import microsoft_list_messages
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    microsoft_list_messages, email,
                    folder=folder or "INBOX", category=category,
                    search=search, limit=limit, page_token=page_token,
                ),
                timeout=REMOTE_LIST_TIMEOUT_S,
            )
        else:
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    imap_list_messages, email,
                    folder=folder or "INBOX",
                    search=search, limit=limit, offset=offset,
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
    if not integration_manager.is_microsoft_account(acc):
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
        # Només caché si no hi ha error
        _MAIL_CACHE.set(cache_key, data)
    return data


@router.get("/messages/{message_id}")
async def get_message(
    message_id: str,
    email: Optional[str] = Query(None),
    folder: Optional[str] = Query(None),
):
    """Hybrid: obté el detall d'un missatge via IMAP o Microsoft Graph.

    Tots els missatges porten prefix `imap_` excepte els de Microsoft. Per
    compatibilitat retro, si arriba un id sense prefix però el compte és
    IMAP, s'interpreta com a UID nu.
    """
    from backend.services.hybrid_mail_service import imap_get_message
    from backend.services.integration_manager import integration_manager

    if email:
        acc = integration_manager.get_mail_account(email)
        if integration_manager.is_microsoft_account(acc):
            from backend.services.microsoft_mail_service import microsoft_get_message
            result = await asyncio.to_thread(microsoft_get_message, email, message_id)
        elif integration_manager.is_imap_account(acc):
            uid = message_id[5:] if message_id.startswith("imap_") else message_id
            result = await asyncio.to_thread(imap_get_message, email, uid, folder or "INBOX")
        else:
            result = None

        if result:
            return result

    # Fallback: cerca al vault (missatges guardats manualment)
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
async def get_thread(thread_id: str, email: str = Query(...)):
    """Retorna tots els missatges d'un thread.

    Per a comptes IMAP-OAuth (Gmail via XOAUTH2): usa `X-GM-THRID` cercant
    a "All Mail" per agrupar INBOX + SENT del mateix thread.
    Per a comptes Microsoft: per ara retorna el missatge sol (no implementat).
    Comptes Google sense IMAP-OAuth (refresh_token absent): fallback a la
    Gmail API tradicional.
    """
    from backend.services.integration_manager import integration_manager

    acc = integration_manager.get_mail_account(email)
    if not acc:
        return {"messages": []}

    # Camí IMAP-XOAUTH2 amb X-GM-THRID
    if integration_manager.is_imap_oauth_account(acc):
        from backend.services.imap_mail_sync_service import imap_sync_service
        # Si el thread_id ve d'imap_get_message és el gm_thrid (numèric)
        # Si ve d'una vista antiga pot ser un Message-ID, busquem-lo primer
        gm_thrid = thread_id
        if not thread_id.isdigit():
            # No és un X-GM-THRID, mirem si és un UID actual
            uid_only = thread_id[5:] if thread_id.startswith("imap_") else thread_id
            from backend.services.hybrid_mail_service import imap_get_message
            mail = await asyncio.to_thread(imap_get_message, email, uid_only, "INBOX")
            if mail and mail.get("gm_thrid"):
                gm_thrid = mail["gm_thrid"]
            else:
                # No es pot resoldre el thread; retornem sol el missatge actual.
                return {"messages": [mail] if mail else []}

        messages = await asyncio.to_thread(
            imap_sync_service.fetch_thread_by_gm_thrid, email, gm_thrid
        )
        return {"messages": messages}

    # Fallback: Gmail API (només si encara queda algun compte sense refresh_token)
    if integration_manager.is_google_account(acc):
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


# ── Push notifications via IMAP IDLE → SSE ───────────────────────────────────

@router.get("/events")
async def mail_events(email: Optional[str] = Query(None)):
    """Server-Sent Events stream amb notificacions push d'IMAP IDLE.

    El client (frontend) s'hi pot subscriure amb `EventSource` i rebrà:
      - `event: new_message` quan EXISTS s'incrementa al servidor
      - `event: message_removed` quan EXPUNGE
      - `event: flags_changed` quan FETCH (FLAGS ...)
      - `event: ping` cada 25s per mantenir la connexió viva

    Si `email` és present, el stream filtra a només aquell compte.
    """
    from fastapi.responses import StreamingResponse
    from backend.services.imap_idle_service import idle_manager

    sub = idle_manager.subscribe(account_filter=email)

    async def event_generator():
        last_ping = time.monotonic()
        try:
            yield "event: ready\ndata: {}\n\n"
            while True:
                # pop_blocking és síncron; fer-lo a un thread per no bloquejar el loop.
                evt = await asyncio.to_thread(sub.pop_blocking, 5.0)
                if evt:
                    name = evt.get("type", "event")
                    import json as _json
                    payload = _json.dumps({
                        "account": evt.get("account"),
                        "type": name,
                        "raw": evt.get("raw"),
                    })
                    yield f"event: {name}\ndata: {payload}\n\n"

                # Ping de heartbeat cada ~25s perquè proxies no tallin la connexió.
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
async def sync_mail_accounts(email: Optional[str] = Query(None), limit: int = 50):
    """Triggers a manual synchronization for one or all mail accounts."""
    try:
        from backend.services.integration_manager import integration_manager
        from backend.services.imap_mail_sync_service import imap_sync_service

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
            log.info(f"Manual sync per a {acc_email}...")
            acc = integration_manager.get_mail_account(acc_email)
            if integration_manager.is_imap_account(acc):
                count = imap_sync_service.sync_account(acc_email, limit=limit)
                if count is None:
                    log.warning(f"[Sync] Connexió IMAP fallida per a {acc_email}")
                    failed_accounts.append(acc_email)
                    count = 0
            else:
                count = sync_service.sync_emails(acc_email, limit=limit)
            total_synced += count or 0

        if failed_accounts and not total_synced and len(failed_accounts) == len(accounts_to_sync):
            raise HTTPException(
                status_code=503,
                detail=f"No s'ha pogut connectar: {', '.join(failed_accounts)}. Comprova les credencials IMAP a Configuració."
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
async def update_message(message_id: str, update: dict = Body(...)):
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

    new_front = yaml.dump(
        metadata, default_flow_style=False, sort_keys=False, allow_unicode=True
    )
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


def _is_imap_account(email: str) -> bool:
    from backend.services.integration_manager import integration_manager
    acc = integration_manager.get_mail_account(email)
    return integration_manager.is_imap_account(acc)


def _is_microsoft_account(email: str) -> bool:
    from backend.services.integration_manager import integration_manager
    acc = integration_manager.get_mail_account(email)
    return integration_manager.is_microsoft_account(acc)


def _resolve_gmail_id(message_id: str) -> str:
    """Returns thread_id from vault if available, otherwise the message_id as-is."""
    mail_path = get_mail_vault_path()
    files = _find_message_files(mail_path, message_id)
    if files:
        try:
            content = files[0].read_text(encoding="utf-8")
            meta, _ = parse_frontmatter(content, files[0])
            return meta.get("thread_id") or message_id
        except Exception:
            pass
    return message_id


@router.post("/messages/{message_id}/trash", dependencies=[Depends(require_role("editor"))])
async def trash_msg(message_id: str, email: str = Query(...), folder: Optional[str] = Query(None)):
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


@router.post("/messages/{message_id}/archive", dependencies=[Depends(require_role("editor"))])
async def archive_msg(message_id: str, email: str = Query(...), folder: Optional[str] = Query(None)):
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


@router.post("/messages/{message_id}/star", dependencies=[Depends(require_role("editor"))])
async def star_msg(
    message_id: str, email: str = Query(...), starred: bool = Body(..., embed=True)
):
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
    

@router.post("/messages/{message_id}/spam", dependencies=[Depends(require_role("editor"))])
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


@router.post("/empty_folder", dependencies=[Depends(require_role("admin"))])
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
        
        # Fallback: busca per paraula clau en TOTES les carpetes IMAP (sense filtratge de tipus)
        real_name = None
        if not folder_info and folder.upper() in ("TRASH", "SPAM"):
            keywords = ["trash", "paperera", "papelera", "deleted", "bin", "wastebasket"] if folder.upper() == "TRASH" else ["spam", "junk", "brossa"]
            all_raw = imap_sync_service.list_all_raw_folders(email)
            for kw in keywords:
                match = next((n for n in all_raw if kw in n.lower()), None)
                if match:
                    real_name = match
                    log.info(f"[IMAP] Carpeta trobada per fallback raw '{kw}': {real_name}")
                    break

        if not folder_info and not real_name:
            # Si list_folders retorna buit probablement és error de connexió/autenticació
            if not folders:
                log.warning(f"[IMAP] No s'ha pogut connectar al compte {email} — credencials incorrectes?")
                raise HTTPException(status_code=503, detail=f"No s'ha pogut connectar al compte {email}. Comprova les credencials IMAP a Configuració.")
            log.warning(f"[IMAP] Carpeta {folder} no trobada per a {email}")
            raise HTTPException(status_code=404, detail=f"Folder {folder} not found")

        if not real_name:
            real_name = folder_info["name"]
        is_trash = (folder_info["type"] == "Deleted" if folder_info else False) or folder.upper() == "TRASH"
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
                raise HTTPException(
                    status_code=500,
                    detail=safe_error_detail(e, "Gmail empty folder"),
                )

    raise HTTPException(status_code=500, detail="Error buidant la carpeta")


@router.post("/drafts")
async def save_draft(payload: dict = Body(...)):
    """Auto-saves a draft.

    Per a comptes IMAP (inclou Google via XOAUTH2), fa `IMAP APPEND` a la
    carpeta de Drafts del servidor (p.ex. `[Gmail]/Drafts`) amb la flag
    `\\Draft`, així apareix al Gmail/Outlook web. El vault local es manté
    com a cache per a visibilitat immediata i com a fallback si APPEND
    falla (p.ex. token caducat o ofline).

    Per als comptes sense IMAP (mai no hauria d'arribar després de la
    migració, però per seguretat), només es guarda al vault.
    """
    from backend.services.integration_manager import integration_manager

    draft_id = payload.get("draft_id") or None
    prev_imap_uid = payload.get("imap_uid") or None
    to = payload.get("to", "")
    cc = payload.get("cc", "")
    bcc = payload.get("bcc", "")
    subject = payload.get("subject", "")
    body = payload.get("body", "")
    email_account = payload.get("account", "")

    acc = integration_manager.get_mail_account(email_account) if email_account else None

    # APPEND a IMAP/Drafts si el compte ho permet
    new_imap_uid = None
    if acc and integration_manager.is_imap_account(acc):
        from backend.services.imap_mail_sync_service import imap_sync_service
        try:
            new_imap_uid = await asyncio.to_thread(
                imap_sync_service.append_draft,
                email_account, to, subject, body,
                cc=cc, bcc=bcc, replace_uid=prev_imap_uid,
            )
        except Exception as e:
            log.warning(f"[Drafts] APPEND IMAP fallit per {email_account}: {e}; segueixo al vault.")

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
        "title": subject or "(Esborrany)", "id": draft_id, "gmail_id": draft_id,
        "thread_id": draft_id, "type": "Draft", "sender": email_account,
        "recipients": to, "cc": cc, "bcc": bcc, "date": datetime.now(timezone.utc).isoformat(),
        "is_read": True, "is_starred": False, "has_attachments": False, "has_html": False,
        "category": "Main", "archived": False, "spam": False,
        "account": email_account, "database_table_id": "mail",
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


@router.delete("/drafts/{draft_id}", dependencies=[Depends(require_role("editor"))])
async def delete_draft(draft_id: str):
    # Validate draft_id (same allow-list as message_id) before glob.
    draft_id = _validate_message_id(draft_id)
    mail_path = get_mail_vault_path()
    deleted = False
    for f in list(mail_path.glob(f"{draft_id}_*.md")) + list(mail_path.glob(f"{draft_id}.md")):
        f.unlink(missing_ok=True)
        deleted = True
    _invalidate_mail_cache()
    return {"status": "deleted" if deleted else "not_found"}


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
    from_name: str = Form(default=None),
    from_email: str = Form(default=None),
    attachments: List[UploadFile] = File(default=[]),
):
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
        success = microsoft_send_message(smtp_email, to, subject, body, cc, bcc)
    elif _is_imap_account(smtp_email):
        from backend.services.imap_mail_sync_service import imap_smtp_send
        imap_acc = acc or integration_manager.get_mail_account(smtp_email) or {}
        success = imap_smtp_send(
            imap_acc, to, subject, body, cc, bcc, attachment_data or None,
            from_email=from_email or email,
            from_name=from_name or imap_acc.get("display_name"),
        )
    elif attachment_data:
        success = send_new_message_with_attachments(
            smtp_email, to, subject, body, cc, bcc, attachment_data
        )
    else:
        success = send_new_message(smtp_email, to, subject, body, cc, bcc)

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
    """Move a message to a different folder (IMAP) or apply label changes (Gmail)."""
    target_folder = payload.get("target_folder")
    if not target_folder:
        raise HTTPException(status_code=400, detail="Missing target_folder")

    from backend.services.integration_manager import integration_manager
    acc = integration_manager.get_mail_account(email)

    if integration_manager.is_imap_account(acc):
        from backend.services.imap_mail_sync_service import imap_sync_service
        imap_uid = payload.get("imap_uid")
        imap_folder = payload.get("imap_folder")
        if imap_uid and imap_folder:
            ok = imap_sync_service.move_message_by_uid(email, imap_uid, imap_folder, target_folder)
        else:
            ok = imap_sync_service.move_message(email, message_id, target_folder)
        if ok:
            _invalidate_mail_cache()
            return {"status": "success"}
        raise HTTPException(status_code=500, detail="Error moving message")

    if integration_manager.is_google_account(acc):
        from backend.services.google_mail_service import get_gmail_service
        gmail_id = _resolve_gmail_id(message_id)
        folder_upper = target_folder.upper()
        service = get_gmail_service(email)
        if not service:
            raise HTTPException(status_code=500, detail="No s'ha pogut connectar amb Gmail")
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
                        userId="me", id=gmail_id,
                        body={"addLabelIds": ["SPAM"], "removeLabelIds": ["INBOX", "TRASH"]}
                    ).execute()
                except Exception:
                    service.users().messages().modify(
                        userId="me", id=gmail_id,
                        body={"addLabelIds": ["SPAM"], "removeLabelIds": ["INBOX", "TRASH"]}
                    ).execute()
            else:
                raise HTTPException(status_code=400, detail=f"Carpeta Gmail no suportada: {target_folder}")
            _invalidate_mail_cache()
            return {"status": "success"}
        except HTTPException:
            raise
        except Exception as e:
            log.error(f"[Gmail] Error movent {gmail_id} a {target_folder}: {e}")
            raise HTTPException(status_code=500, detail=f"Error movent a Gmail: {e}")

    if _is_microsoft_account(email):
        from backend.services.microsoft_mail_service import microsoft_move_message
        if microsoft_move_message(email, message_id, target_folder):
            _invalidate_mail_cache()
            return {"status": "success"}
        raise HTTPException(status_code=500, detail="Error movent a Microsoft")

    raise HTTPException(status_code=400, detail="Compte no suportat per moure missatges")


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

    _COUNTS_CACHE.pop(email)
    return {"status": "success", "processed": success_count}


@router.post("/messages/{message_id}/read")
async def mark_as_read(message_id: str, email: str = Query(...)):
    """Marca un missatge com a llegit (treu l'etiqueta UNREAD a Gmail o posa \\Seen a IMAP)."""
    if _is_microsoft_account(email):
        from backend.services.microsoft_mail_service import microsoft_mark_read
        if microsoft_mark_read(email, message_id, True):
            _invalidate_mail_cache()
            return {"status": "success"}
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
    files = _find_message_files(mail_path, message_id)
    if not files:
        raise HTTPException(status_code=404, detail="Message not found")

    file_path = files[0]
    content = file_path.read_text(encoding="utf-8")
    metadata, body = parse_frontmatter(content, file_path)
    metadata["snoozed_until"] = snooze_until

    new_front = yaml.dump(
        metadata, default_flow_style=False, sort_keys=False, allow_unicode=True
    )
    safe_write_text(file_path, f"---\n{new_front}---\n\n{body}\n")
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

    if _is_microsoft_account(email):
        from backend.services.microsoft_mail_service import microsoft_reply_message
        success = microsoft_reply_message(email, message_id, body, to, cc, bcc)
    else:
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

    from datetime import date
    today = date.today().isoformat()

    system_prompt = f"""Analitza el contingut d'aquest correu electrònic i extreu esdeveniments de calendari i contactes.
L'email pot estar en qualsevol idioma (català, castellà, anglès, francès...).
La data d'avui és {today}.

Retorna ÚNICAMENT un objecte JSON amb els camps 'events' i 'contacts'. Sense cap text addicional, sense markdown.
Si no hi ha entitats, retorna arrays buits.

Formats de data a reconèixer (exemples no exhaustius):
- "dia 6 de maig de 2026 a les 09.30 hores" → 2026-05-06T09:30:00
- "el proper dilluns a les 10h" → calcula a partir de {today}
- "6 de mayo de 2026 a las 10:00" → 2026-05-06T10:00:00
- "May 6th 2026 at 10am" → 2026-05-06T10:00:00

Events han de tenir:
- title: string (nom curt descriptiu de l'esdeveniment)
- start: string ISO 8601 (si no hi ha hora, usa T09:00:00)
- end: string ISO 8601 (si no s'especifica, 1 hora després de start)
- location: string (buit si no s'esmenta)
- description: string (resum breu)

Contacts han de tenir:
- name: string
- email: string
- phone: string
- company: string
- notes: string

CONTINGUT DEL CORREU:
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
        return {
            "events": [],
            "contacts": [],
            "error": safe_error_detail(e, "AI parse mail entities"),
            "raw": content,
        }



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


@router.delete("/views/{view_id}", status_code=204, dependencies=[Depends(require_role("editor"))])
async def delete_view(view_id: str, db: Session = Depends(get_db)):
    view = db.query(MailView).filter(MailView.id == view_id).first()
    if not view:
        raise HTTPException(status_code=404, detail="Vista no trobada")
    db.delete(view)
    db.commit()


async def _gmail_get_attachment_bytes(email: str, message_id: str, attachment_id: str) -> tuple:
    """Returns (data_bytes, content_type) for a Gmail attachment."""
    import base64
    from backend.services.google_mail_service import get_gmail_service
    service = get_gmail_service(email)
    if not service:
        return None, None
    att = service.users().messages().attachments().get(
        userId="me", messageId=message_id, id=attachment_id
    ).execute()
    data = base64.urlsafe_b64decode(att.get("data", "") + "==")
    return data, None


async def _imap_fetch_raw(email: str, message_id: str, folder: str):
    """Returns (raw_bytes, imap_conn) for an IMAP message. Caller must release the pool."""
    from backend.services.hybrid_mail_service import _get_imap_account, _imap_pool_acquire, _imap_folder_name
    acc = _get_imap_account(email)
    if not acc:
        return None, None
    imap = _imap_pool_acquire(acc)
    if not imap:
        return None, None
    uid = message_id[5:] if message_id.startswith("imap_") else message_id
    folder_name = _imap_folder_name(imap, folder)
    imap.select(f'"{folder_name}"', readonly=True)
    status, data = imap.uid("fetch", uid, "(BODY[])")
    if status != "OK" or not data:
        return None, imap
    raw_bytes = next((p[1] for p in data if isinstance(p, tuple)), None)
    return raw_bytes, imap


@router.get("/messages/{message_id}/attachments/{att_id:path}")
async def get_attachment(
    message_id: str,
    att_id: str,
    email: str = Query(...),
    folder: str = Query("INBOX"),
    inline: bool = Query(False),
    content_type_hint: Optional[str] = Query(None, alias="content_type"),
    filename_hint: Optional[str] = Query(None, alias="filename"),
):
    """Downloads an attachment — works for Gmail (att_id=attachmentId) and IMAP (att_id=part_index)."""
    from fastapi.responses import Response
    from backend.services.integration_manager import integration_manager

    disposition = "inline" if inline else "attachment"
    acc = integration_manager.get_mail_account(email)

    # Tots els proveïdors IMAP (inclou Google amb refresh_token) usen part_index.
    # Microsoft Graph manté l'API original; Gmail API només queda com a fallback
    # per comptes Google sense refresh_token (cas degradat).
    if integration_manager.is_imap_account(acc):
        pass  # cau a IMAP path
    elif integration_manager.is_google_account(acc):
        data, _ = await _gmail_get_attachment_bytes(email, message_id, att_id)
        if not data:
            raise HTTPException(status_code=404, detail="Adjunt no trobat")
        media_type = content_type_hint or "application/octet-stream"
        safe_filename = filename_hint or "attachment"
        return Response(content=data, media_type=media_type,
                        headers={"Content-Disposition": f'{disposition}; filename="{safe_filename}"'})

    # IMAP path
    import email as email_lib
    from backend.services.hybrid_mail_service import _imap_pool_release, _imap_pool_invalidate, _decode_mime
    raw_bytes, imap = await _imap_fetch_raw(email, message_id, folder)
    if not raw_bytes:
        if imap:
            _imap_pool_release(email)
        raise HTTPException(status_code=404, detail="Missatge no trobat")
    try:
        msg = email_lib.message_from_bytes(raw_bytes)
        parts = list(msg.walk())
        idx = int(att_id)
        if idx >= len(parts):
            raise HTTPException(status_code=404, detail="Adjunt no trobat")
        part = parts[idx]
        payload = part.get_payload(decode=True)
        if not payload:
            raise HTTPException(status_code=404, detail="Adjunt buit")
        filename = _decode_mime(part.get_filename() or f"attachment_{idx}")
        content_type = part.get_content_type() or "application/octet-stream"
        return Response(content=payload, media_type=content_type,
                        headers={"Content-Disposition": f'{disposition}; filename="{filename}"'})
    except HTTPException:
        raise
    except Exception as e:
        _imap_pool_invalidate(email)
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "GET /messages attachment"),
        )
    finally:
        _imap_pool_release(email)


@router.get("/messages/{message_id}/cid/{cid:path}")
async def get_cid_image(
    message_id: str,
    cid: str,
    email: str = Query(...),
    folder: str = Query("INBOX"),
):
    """Serves an inline CID image — works for Gmail and IMAP."""
    from fastapi.responses import Response
    from backend.services.integration_manager import integration_manager

    acc = integration_manager.get_mail_account(email)

    # IMAP-eligible (inclou Google amb refresh_token) → IMAP path.
    # Gmail API només per comptes Google sense refresh_token (cas degradat).
    if integration_manager.is_imap_account(acc):
        pass  # IMAP path
    elif integration_manager.is_google_account(acc):
        # For Gmail, fetch full message to find CID→attachmentId mapping
        from backend.services.hybrid_mail_service import gmail_get_message
        mail = await asyncio.to_thread(gmail_get_message, email, message_id)
        if not mail:
            raise HTTPException(status_code=404, detail="Missatge no trobat")
        cid_clean = cid.strip("<>")
        match = next((img for img in (mail.get("inline_images") or [])
                      if img["cid"].strip("<>") == cid_clean), None)
        if not match:
            raise HTTPException(status_code=404, detail="Imatge CID no trobada")
        data, _ = await _gmail_get_attachment_bytes(email, message_id, match["attachment_id"])
        if not data:
            raise HTTPException(status_code=404, detail="Imatge no disponible")
        return Response(content=data, media_type=match.get("content_type", "image/png"))

    # IMAP path
    import email as email_lib
    from backend.services.hybrid_mail_service import _imap_pool_release, _imap_pool_invalidate
    raw_bytes, imap = await _imap_fetch_raw(email, message_id, folder)
    if not raw_bytes:
        if imap:
            _imap_pool_release(email)
        raise HTTPException(status_code=404, detail="Missatge no trobat")

    try:
        msg = email_lib.message_from_bytes(raw_bytes)
        cid_clean = cid.strip("<>")
        for part in msg.walk():
            part_cid = part.get("Content-ID", "").strip("<>")
            if part_cid == cid_clean or part_cid == cid:
                payload = part.get_payload(decode=True)
                if payload:
                    return Response(content=payload, media_type=part.get_content_type() or "image/png")
        raise HTTPException(status_code=404, detail="Imatge CID no trobada")
    except HTTPException:
        raise
    except Exception as e:
        _imap_pool_invalidate(email)
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "GET /messages CID image"),
        )
    finally:
        _imap_pool_release(email)


@router.patch("/accounts/{email:path}/enabled")
async def set_account_enabled(email: str, body: dict):
    enabled = body.get("enabled", True)
    from backend.services.integration_manager import integration_manager
    found = integration_manager.set_mail_account_enabled(email, bool(enabled))
    if not found:
        raise HTTPException(status_code=404, detail="Compte no trobat")
    return {"email": email, "enabled": bool(enabled)}


# ── Tags CRUD ────────────────────────────────────────────────────────────────────

def _tag_to_dict(tag: MailTag) -> dict:
    return {
        "id": tag.id,
        "name": tag.name,
        "color": tag.color,
        "created_at": tag.created_at.isoformat() if tag.created_at else None,
    }


@router.get("/tags")
async def list_tags(db: Session = Depends(get_db)):
    tags = db.query(MailTag).order_by(MailTag.created_at).all()
    return [_tag_to_dict(t) for t in tags]


@router.post("/tags", status_code=201)
async def create_tag(payload: MailTagCreateSchema, db: Session = Depends(get_db)):
    tag = MailTag(name=payload.name, color=payload.color)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return _tag_to_dict(tag)


@router.put("/tags/{tag_id}")
async def update_tag(tag_id: str, payload: MailTagUpdateSchema, db: Session = Depends(get_db)):
    tag = db.query(MailTag).filter(MailTag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Etiqueta no trobada")
    if payload.name is not None:
        tag.name = payload.name
    if payload.color is not None:
        tag.color = payload.color
    db.commit()
    db.refresh(tag)
    return _tag_to_dict(tag)


@router.delete("/tags/{tag_id}", status_code=204, dependencies=[Depends(require_role("editor"))])
async def delete_tag(tag_id: str, db: Session = Depends(get_db)):
    tag = db.query(MailTag).filter(MailTag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Etiqueta no trobada")
    db.query(MailMessageTag).filter(MailMessageTag.tag_id == tag_id).delete()
    db.delete(tag)
    db.commit()


# ── Message ↔ Tag Association ────────────────────────────────────────────────────

@router.get("/messages/{message_id}/tags")
async def get_message_tags(message_id: str, db: Session = Depends(get_db)):
    rows = db.query(MailMessageTag).filter(MailMessageTag.message_id == message_id).all()
    return [row.tag_id for row in rows]


@router.post("/messages/{message_id}/tags")
async def set_message_tags(
    message_id: str, payload: MailMessageTagsSetSchema, db: Session = Depends(get_db)
):
    db.query(MailMessageTag).filter(MailMessageTag.message_id == message_id).delete()
    for tag_id in payload.tag_ids:
        tag_exists = db.query(MailTag).filter(MailTag.id == tag_id).first()
        if not tag_exists:
            raise HTTPException(status_code=404, detail=f"Etiqueta {tag_id} no trobada")
        assoc = MailMessageTag(
            message_id=message_id,
            tag_id=tag_id,
            account_email=payload.account_email,
            subject=payload.subject,
            sender=payload.sender,
            date_str=payload.date_str,
        )
        db.add(assoc)
    db.commit()
    return {"status": "success", "tag_ids": payload.tag_ids}


@router.get("/tags/{tag_id}/messages")
async def get_tagged_messages(tag_id: str, db: Session = Depends(get_db)):
    tag = db.query(MailTag).filter(MailTag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Etiqueta no trobada")
    rows = db.query(MailMessageTag).filter(MailMessageTag.tag_id == tag_id).all()
    return {
        "tag": _tag_to_dict(tag),
        "messages": [
            {
                "message_id": r.message_id,
                "account_email": r.account_email,
                "subject": r.subject,
                "sender": r.sender,
                "date_str": r.date_str,
            }
            for r in rows
        ],
    }


@router.post("/tags/messages/batch")
async def get_tags_for_messages(payload: dict = Body(...), db: Session = Depends(get_db)):
    message_ids = payload.get("message_ids", [])
    if not message_ids:
        return {}
    rows = (
        db.query(MailMessageTag)
        .filter(MailMessageTag.message_id.in_(message_ids))
        .all()
    )
    result: dict = {mid: [] for mid in message_ids}
    for row in rows:
        result[row.message_id].append(row.tag_id)
    return result
