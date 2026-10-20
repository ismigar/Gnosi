"""
Hybrid Mail Service — queries the Gmail API and IMAP directly without a vault.
"""

import email as email_lib
import hashlib
import imaplib
import json
import logging
import re
import threading
from typing import Any, Optional, cast

from backend.domains.mail.providers.common import (
    _decode_mime as _decode_mime,
)
from backend.domains.mail.providers.common import (
    _ts as _ts,
)
from backend.domains.mail.providers.gmail import (
    _GMAIL_CATEGORY_QUERY as _GMAIL_CATEGORY_QUERY,
)
from backend.domains.mail.providers.gmail import (
    _GMAIL_COUNT_LABELS as _GMAIL_COUNT_LABELS,
)
from backend.domains.mail.providers.gmail import (
    _GMAIL_FOLDER_QUERY as _GMAIL_FOLDER_QUERY,
)
from backend.domains.mail.providers.gmail import (
    _GMAIL_LABEL_TO_CATEGORY as _GMAIL_LABEL_TO_CATEGORY,
)
from backend.domains.mail.providers.gmail import (
    _extract_gmail_body as _extract_gmail_body,
)
from backend.domains.mail.providers.gmail import (
    _extract_gmail_parts as _extract_gmail_parts,
)
from backend.domains.mail.providers.gmail import (
    _gmail_batch_metadata as _gmail_batch_metadata,
)
from backend.domains.mail.providers.gmail import (
    _parse_gmail_meta as _parse_gmail_meta,
)
from backend.domains.mail.providers.gmail import (
    gmail_get_counts as gmail_get_counts,
)
from backend.domains.mail.providers.gmail import (
    gmail_get_message as gmail_get_message,
)
from backend.domains.mail.providers.gmail import (
    gmail_list_messages as gmail_list_messages,
)
from backend.services.integration_manager import integration_manager
from backend.utils.safe_io import sanitize_filename_component
from backend.domains.mail.providers.imap_listing import HEADER_FIELDS, list_all_mailboxes, search_uids
from backend.domains.mail.sync.imap_protocol import _imap_name
from backend.services.context_vars import active_vault_path

log = logging.getLogger(__name__)

# ── IMAP connection pool ───────────────────────────────────────────────────────
# A persistent connection per account. Lock per account to prevent concurrent use.
_IMAP_POOL: dict[str, imaplib.IMAP4] = {}
_IMAP_LOCKS: dict[str, threading.Lock] = {}
_IMAP_MESSAGE_POOL: dict[str, imaplib.IMAP4] = {}
_IMAP_MESSAGE_LOCKS: dict[str, threading.Lock] = {}
_IMAP_META = threading.Lock()  # Protects _IMAP_POOL and _IMAP_LOCKS.
_IMAP_CONNECTION_KEYS: dict[tuple[str, bool], str] = {}
_IMAP_CONNECTION_GENERATIONS: dict[tuple[str, bool], object] = {}

_IMAP_TIMEOUT = 20  # seconds

# Last authentication error reason per email. Populated in `_imap_connect_fresh`
# and the endpoints (list/get/counts) read it to return a message
# explanatory if the account fails due to OAuth (vs network/host).
_LAST_AUTH_ERROR: dict[str, str] = {}


def _imap_connection_key(acc: dict[str, Any]) -> str:
    fields = (
        "email", "type", "provider", "imap_host", "imap_port", "imap_user",
        "imap_username", "imap_encryption", "imap_password", "refresh_token",
    )
    values = [str(active_vault_path.get()), *(acc.get(field) for field in fields)]
    return hashlib.sha256(json.dumps(values, default=str).encode()).hexdigest()


def _close_imap_connection(connection: Any) -> None:
    try:
        connection.logout()
    except Exception:
        pass


def _usable_imap_connection(connection: Any, same_configuration: bool) -> Any:
    if connection is None:
        return None
    if same_configuration:
        try:
            status, _ = connection.noop()
            if status == "OK":
                return connection
        except Exception:
            pass
    _close_imap_connection(connection)
    return None


def _imap_pool_acquire(
    acc: dict[str, Any], *, message: bool = False,
) -> Optional[imaplib.IMAP4]:
    """Returns an IMAP connection from the pool, reconnecting if needed.
    The caller must release it by calling _imap_pool_release(email)."""
    email = acc.get("email") or acc.get("imap_user")
    if not email:
        return None

    # A user opening a body must not wait for a mailbox search, attachment or
    # list refresh. Keep one reusable, independently locked connection per lane.
    pool = _IMAP_MESSAGE_POOL if message else _IMAP_POOL
    locks = _IMAP_MESSAGE_LOCKS if message else _IMAP_LOCKS
    lane = (email, message)
    identity = _imap_connection_key(acc)
    with _IMAP_META:
        lock = locks.setdefault(email, threading.Lock())
        generation = _IMAP_CONNECTION_GENERATIONS.setdefault(lane, object())

    if not lock.acquire(timeout=_IMAP_TIMEOUT):
        return None

    try:
        with _IMAP_META:
            current = _IMAP_CONNECTION_GENERATIONS.get(lane) is generation
            connection = pool.get(email)
            same_configuration = _IMAP_CONNECTION_KEYS.get(lane) == identity
        if not current:
            lock.release()
            return None
        imap = _usable_imap_connection(connection, same_configuration)
        if imap is None:
            with _IMAP_META:
                pool.pop(email, None)
                _IMAP_CONNECTION_KEYS.pop(lane, None)
            imap = _imap_connect_fresh(acc)
        if imap is None:
            lock.release()
            return None
        with _IMAP_META:
            current = _IMAP_CONNECTION_GENERATIONS.get(lane) is generation
            if current:
                pool[email] = imap
                _IMAP_CONNECTION_KEYS[lane] = identity
        if not current:
            _close_imap_connection(imap)
            lock.release()
            return None
        return cast(imaplib.IMAP4, imap)
    except Exception:
        lock.release()
        raise


def _imap_pool_release(email: str, *, message: bool = False) -> None:
    """Releases the account lock so other requests can use the connection."""
    locks = _IMAP_MESSAGE_LOCKS if message else _IMAP_LOCKS
    lock = locks.get(email)
    if lock and lock.locked():
        try:
            lock.release()
        except RuntimeError:
            pass


def _imap_pool_invalidate(email: str, *, message: bool | None = None) -> None:
    """Invalidate both credential lanes, or only one failed transport lane."""
    lanes = (False, True) if message is None else (message,)
    connections = []
    with _IMAP_META:
        for lane in lanes:
            pool = _IMAP_MESSAGE_POOL if lane else _IMAP_POOL
            connection = pool.pop(email, None)
            _IMAP_CONNECTION_KEYS.pop((email, lane), None)
            _IMAP_CONNECTION_GENERATIONS.pop((email, lane), None)
            if connection is not None:
                connections.append(connection)
    if message is None:
        from backend.domains.mail.cache import _invalidate_mail_cache

        _invalidate_mail_cache()
    for connection in connections:
        _close_imap_connection(connection)


_IMAP_TYPE_TO_KEY = {
    "Received": "INBOX",
    "Sent": "SENT",
    "Draft": "DRAFTS",
    "Deleted": "TRASH",
    "Spam": "SPAM",
    "Archived": "ARCHIVE",
    "All": "all",
}

_FOLDER_TO_TYPE = {
    "INBOX": "Received",
    "SENT": "Sent",
    "DRAFTS": "Draft",
    "TRASH": "Deleted",
    "SPAM": "Spam",
}


def _get_imap_account(email: str) -> dict[str, Any] | None:
    """Returns the account dict if *email* should be accessed via IMAP.

    Covers: manual (any IMAP), Outlook (injects default host/port), and
    Google OAuth2 (injects imap.gmail.com/smtp.gmail.com and authenticates via
    XOAUTH2 when connecting). Google requires a `refresh_token` saved on the account.

    """
    acc = integration_manager.get_mail_account(email)
    if not acc or not integration_manager.is_imap_account(acc):
        return None
    return integration_manager.resolve_imap_defaults(acc)


def _imap_connect_fresh(acc: dict[str, Any]) -> Optional[imaplib.IMAP4]:
    host = acc.get("imap_host")
    port = int(acc.get("imap_port") or 993)
    user = acc.get("imap_user") or acc.get("imap_username") or acc.get("email")
    enc = acc.get("imap_encryption", "ssl").lower()
    if not host or not user:
        log.error(f"[IMAP] Host or user is missing for {acc.get('email')}")
        return None
    try:
        imap: imaplib.IMAP4
        if enc == "ssl":
            imap = imaplib.IMAP4_SSL(host, port, timeout=_IMAP_TIMEOUT)
        else:
            imap = imaplib.IMAP4(host, port, timeout=_IMAP_TIMEOUT)
            if enc == "starttls":
                imap.starttls()

        if integration_manager.is_imap_oauth_account(acc):
            from backend.services.oauth2_helpers import (
                OAuth2RefreshError,
                ensure_fresh_token,
                xoauth2_imap_login,
            )

            email = str(acc.get("email") or "")
            if not email:
                log.error("[IMAP-XOAUTH2] Missing account email")
                return None
            try:
                access_token, _ = ensure_fresh_token(email)
            except OAuth2RefreshError as e:
                log.error(f"[IMAP-XOAUTH2] Refresh token expired for {email}")
                _LAST_AUTH_ERROR[email] = str(e)
                try:
                    imap.logout()
                except Exception:
                    pass
                return None
            if not access_token:
                msg = (
                    f"Could not obtain an OAuth2 access token for {email}. "
                    "Check the credentials in Settings."
                )
                log.error(f"[IMAP-XOAUTH2] {msg}")
                _LAST_AUTH_ERROR[email] = msg
                try:
                    imap.logout()
                except Exception:
                    pass
                return None
            xoauth2_imap_login(imap, email, access_token)
            _LAST_AUTH_ERROR.pop(email, None)
            log.debug(f"[IMAP-XOAUTH2] Login OK per {email}@{host}")
        else:
            pwd = acc.get("imap_password")
            if not pwd:
                log.error(f"[IMAP] No password for {user}@{host}")
                try:
                    imap.logout()
                except Exception:
                    pass
                return None
            imap.login(user, pwd)
        return imap
    except Exception as e:
        log.error(f"[IMAP] Connection failed for {user}@{host}: {e}")
        return None


def _imap_folder_name(imap: Any, folder_type: str, *, gmail: bool = False) -> Optional[str]:
    """Returns the real IMAP folder name for a logical type."""
    if folder_type in ("INBOX", "NOT_ARCHIVED", "STARRED"):
        return "INBOX"
    from backend.services.imap_mail_sync_service import _FOLDER_TYPE_MAP_REVERSE, _discover_folders

    wanted_type = _FOLDER_TYPE_MAP_REVERSE.get(folder_type.upper())
    folders = _discover_folders(imap, strict=True)
    if gmail and folder_type == "ARCHIVE":
        return next((name for name, kind in folders if kind == "All"), None)
    for name, _ftype in folders:
        if name == folder_type:
            return name
    for name, ftype in folders:
        if wanted_type and ftype == wanted_type:
            return name
    if folder_type.upper() == "ARCHIVE":
        return next((name for name, kind in folders if kind == "All"), None)
    return None


# ══════════════════════════════════════════════════════════════════════
# GMAIL — LIST
# ══════════════════════════════════════════════════════════════════════


# ══════════════════════════════════════════════════════════════════════
# GMAIL — DETAILS
# ══════════════════════════════════════════════════════════════════════


# ══════════════════════════════════════════════════════════════════════
# GMAIL — COUNTERS
# ══════════════════════════════════════════════════════════════════════


# ══════════════════════════════════════════════════════════════════════
# IMAP — LIST
# ══════════════════════════════════════════════════════════════════════


def _imap_search_criteria(folder: str, search: str | None) -> str:
    text = "".join(" " if ord(character) < 32 or ord(character) == 127 else character for character in (search or ""))
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    terms = ["FLAGGED"] if folder == "STARRED" else []
    if escaped:
        terms.append(f'TEXT "{escaped}"')
    return " ".join(terms) or "ALL"


def _imap_is_gmail(imap: Any, acc: dict[str, Any]) -> bool:
    capabilities = {
        value.decode().upper() if isinstance(value, bytes) else str(value).upper()
        for value in getattr(imap, "capabilities", ())
    }
    return integration_manager.is_imap_oauth_account(acc) or "X-GM-EXT-1" in capabilities


def _imap_aggregate_folders(imap: Any, folder: str, *, gmail: bool) -> list[tuple[str, str]] | None:
    logical = folder.upper()
    if logical not in ("ALL", "ARCHIVE"):
        return None
    from backend.domains.mail.sync.imap_protocol import _discover_folder_details

    details = _discover_folder_details(imap, strict=True)
    folders = [(info.name, info.kind) for info in details if info.selectable]
    native_all = [entry for entry in folders if entry[1] == "All"]
    if logical == "ALL":
        return native_all[:1] or [entry for entry in folders if entry[1] not in ("Deleted", "Spam", "All")]
    if gmail:
        return native_all[:1]
    return [entry for entry in folders if entry[1] == "Archived"]


def _imap_fetch_metadata(fetch_data: list[Any], index: int) -> str:
    """Read attributes on both sides of an IMAP body literal."""
    part = fetch_data[index]
    info_head = bytes(part[0]).decode("utf-8", errors="replace")
    next_part = fetch_data[index + 1] if index + 1 < len(fetch_data) else None
    tail = (
        bytes(next_part).decode("utf-8", errors="replace")
        if isinstance(next_part, (bytes, bytearray))
        else ""
    )
    return info_head + " " + tail


def _imap_list_item(
    fetch_data: list[Any], index: int, folder: str, account_email: str, folder_name: str
) -> dict[str, Any] | None:
    part = fetch_data[index]
    if not isinstance(part, tuple):
        return None
    info = _imap_fetch_metadata(fetch_data, index)
    uid_match = re.search(r"UID (\d+)", info, re.IGNORECASE)
    if not uid_match:
        return None
    uid = uid_match.group(1)
    flags_match = re.search(r"FLAGS \(([^)]*)\)", info, re.IGNORECASE)
    flags = (flags_match.group(1) if flags_match else "").lower()
    thread_match = re.search(r"X-GM-THRID (\d+)", info)
    gmail_thread_id = thread_match.group(1) if thread_match else None
    labels_match = re.search(r"X-GM-LABELS \(([^)]*)\)", info, re.IGNORECASE)
    labels = labels_match.group(1).lower() if labels_match else ""
    msg = email_lib.message_from_bytes(part[1])
    date_str = msg.get("Date", "")
    message_id = sanitize_filename_component(msg.get("Message-ID", ""))
    internet_message_id = str(msg.get("Message-ID", "")).strip().strip("<>")
    message_type = _FOLDER_TO_TYPE.get(folder.upper(), "Received")
    for label, kind in (("\\trash", "Deleted"), ("\\spam", "Spam"), ("\\draft", "Draft"), ("\\sent", "Sent")):
        if label in labels:
            message_type = kind
            break
    return {
        "id": f"imap_{uid}",
        "imap_uid": uid,
        "thread_id": gmail_thread_id or message_id or f"imap_{uid}",
        "internet_message_id": internet_message_id or None,
        "gm_thrid": gmail_thread_id,
        "subject": _decode_mime(msg.get("Subject", "(sense assumpte)")),
        "sender": _decode_mime(msg.get("From", "")),
        "recipient": _decode_mime(msg.get("To", "")),
        "cc": _decode_mime(msg.get("Cc", "")),
        "bcc": _decode_mime(msg.get("Bcc", "")),
        "date": date_str,
        "timestamp": _ts(date_str),
        "snippet": "",
        "is_read": "\\seen" in flags,
        "is_starred": "\\flagged" in flags,
        "archived": folder.upper() == "ARCHIVE" or (
            labels_match is not None
            and not any(label in labels for label in ("\\inbox", "\\draft", "\\trash", "\\spam"))
        ),
        "has_attachments": False,
        "category": "Main",
        "type": message_type,
        "account": account_email,
        "source": "imap",
        "imap_folder": folder_name,
    }


def imap_list_messages(
    email: str,
    folder: str = "INBOX",
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    acc = _get_imap_account(email)
    if not acc:
        error_message = f"No IMAP configuration was found for {email}."
        log.error(f"[IMAP] {error_message}")
        return {"messages": [], "total": 0, "error": error_message}

    imap = _imap_pool_acquire(acc)
    if not imap:
        auth_err = _LAST_AUTH_ERROR.get(email)
        if auth_err:
            return {"messages": [], "total": 0, "error": auth_err}
        return {"messages": [], "total": 0, "error": "Mail server temporarily unavailable. Try again shortly."}

    try:
        is_gmail = _imap_is_gmail(imap, acc)
        criteria = _imap_search_criteria(folder, search)
        aggregate = _imap_aggregate_folders(imap, folder, gmail=is_gmail)
        if aggregate is not None:
            if not aggregate:
                return {"messages": [], "total": 0, "error": "The requested mail folder is unavailable."}
            if folder.upper() == "ARCHIVE" and is_gmail:
                criteria = 'X-GM-RAW "-in:inbox -in:drafts -in:trash -in:spam"' + (f" {criteria}" if criteria != "ALL" else "")
            return list_all_mailboxes(
                imap, email, aggregate, criteria, limit, offset, _imap_list_item,
                gmail=is_gmail, logical_folder=folder,
            )
        folder_name = _imap_folder_name(imap, folder, gmail=is_gmail)
        if not folder_name:
            return {"messages": [], "total": 0, "error": "The requested mail folder is unavailable."}

        status, _ = imap.select(_imap_name(folder_name, always_quote=True), readonly=True)
        if status != "OK":
            return {"messages": [], "total": 0, "error": "Unable to open the requested mail folder."}

        status, data = search_uids(imap, criteria)
        if status != "OK" or not data or data[0] is None:
            return {"messages": [], "total": 0, "error": "Unable to read the mail message list."}
        if not data[0]:
            return {"messages": [], "total": 0}

        all_uids = data[0].split()
        total = len(all_uids)

        # Newest first: we take from the end
        start = max(0, total - offset - limit)
        end = max(0, total - offset)
        selected = list(reversed(all_uids[start:end]))

        if not selected:
            return {"messages": [], "total": total}

        uid_str = b",".join(selected).decode()
        # If the server is Gmail (X-GM-EXT-1), we request X-GM-THRID for the
        # transparent threading. Other IMAPs would ignore the argument.
        # Lists use these six headers only. Trace/security headers can dominate
        # large newsletter headers; body and attachment data stay in the detail
        # request. PEEK explicitly preserves unread flags.
        fetch_args = f"(UID FLAGS X-GM-THRID X-GM-LABELS {HEADER_FIELDS})" if is_gmail else f"(UID FLAGS {HEADER_FIELDS})"
        status, fetch_data = imap.uid("fetch", uid_str, fetch_args)
        if status != "OK":
            return {"messages": [], "total": total, "error": "Unable to read mail message headers."}

        messages = [
            item
            for index in range(len(fetch_data))
            if (item := _imap_list_item(fetch_data, index, folder, email, folder_name)) is not None
        ]
        if len(messages) != len(selected) or {str(row["imap_uid"]).encode() for row in messages} != set(selected):
            return {"messages": [], "total": total, "error": "Mail message headers are incomplete. Try again shortly."}
        return {"messages": messages, "total": total}
    except Exception as error:
        _imap_pool_invalidate(email, message=False)
        log.warning("Mail message list unavailable (%s)", type(error).__name__)
        return {"messages": [], "total": 0, "error": "Mail message list is temporarily unavailable. Try again shortly."}
    finally:
        _imap_pool_release(email)


# ══════════════════════════════════════════════════════════════════════
# IMAP — DETAILS
# ══════════════════════════════════════════════════════════════════════


def _imap_fetch_payload(data: list[Any]) -> tuple[bytes | None, str, str | None]:
    for index, part in enumerate(data):
        if not isinstance(part, tuple):
            continue
        info = _imap_fetch_metadata(data, index)
        flags_match = re.search(r"FLAGS \(([^)]*)\)", info, re.IGNORECASE)
        thread_match = re.search(r"X-GM-THRID (\d+)", info)
        raw = part[1]
        return (
            bytes(raw) if isinstance(raw, (bytes, bytearray)) else None,
            (flags_match.group(1) if flags_match else "").lower(),
            thread_match.group(1) if thread_match else None,
        )
    return None, "", None


def _decode_imap_payload(payload: Any, charset: Any) -> str | None:
    if not isinstance(payload, (bytes, bytearray)):
        return None
    normalized = charset or "utf-8"
    if isinstance(normalized, str):
        normalized = normalized.strip().strip('"').strip("'").lower()
        if normalized in ("unknown-8bit", "unknown", "x-unknown", "attachment"):
            normalized = "utf-8"
    try:
        return bytes(payload).decode(normalized, errors="replace")
    except LookupError:
        return bytes(payload).decode("latin1", errors="replace")
    except Exception:
        return bytes(payload).decode("utf-8", errors="replace")


def _multipart_content(
    msg: Any,
) -> tuple[str, str, list[dict[str, Any]], list[dict[str, Any]]]:
    body_text = body_html = ""
    attachments: list[dict[str, Any]] = []
    inline_images: list[dict[str, Any]] = []
    for index, part in enumerate(msg.walk()):
        content_type = part.get_content_type()
        disposition = part.get("Content-Disposition", "")
        raw_cid = part.get("Content-ID", "")
        cid = raw_cid.strip("<>") if raw_cid else None
        filename = part.get_filename()
        filename = _decode_mime(filename) if filename else None
        payload = part.get_payload(decode=True)
        descriptor = {
            "part_index": index,
            "content_type": content_type,
            "size": len(payload) if payload else 0,
        }
        if cid and content_type.startswith("image/"):
            inline_images.append({**descriptor, "cid": cid})
            continue
        if filename and "attachment" in disposition.lower():
            attachments.append({**descriptor, "filename": filename})
            continue
        decoded = _decode_imap_payload(payload, part.get_content_charset())
        if decoded is None:
            continue
        if content_type == "text/plain" and not body_text:
            body_text = decoded
        elif content_type == "text/html" and not body_html:
            body_html = decoded
    return body_text, body_html, attachments, inline_images


def _message_content(
    msg: Any,
) -> tuple[str, str, list[dict[str, Any]], list[dict[str, Any]]]:
    if msg.is_multipart():
        return _multipart_content(msg)
    decoded = _decode_imap_payload(msg.get_payload(decode=True), msg.get_content_charset())
    if decoded is None:
        return "", "", [], []
    if msg.get_content_type() == "text/html":
        return "", decoded, [], []
    return decoded, "", [], []


def imap_get_message(email: str, uid: str, folder: str = "INBOX") -> dict[str, Any] | None:
    if not uid.isascii() or not uid.isdigit() or len(uid) > 10 or not 0 < int(uid) <= 0xFFFFFFFF:
        return None
    acc = _get_imap_account(email)
    if not acc:
        return None

    imap = _imap_pool_acquire(acc, message=True)
    if not imap:
        raise RuntimeError("Mail content connection is temporarily unavailable")

    try:
        folder_name = _imap_folder_name(imap, folder)
        if not folder_name:
            return None

        status, _ = imap.select(_imap_name(folder_name, always_quote=True), readonly=True)
        if status != "OK":
            raise RuntimeError("Unable to open the message mailbox")

        is_gmail = _imap_is_gmail(imap, acc)
        fetch_args = "(FLAGS X-GM-THRID BODY.PEEK[])" if is_gmail else "(FLAGS BODY.PEEK[])"
        status, data = imap.uid("fetch", uid, fetch_args)
        if status != "OK":
            raise RuntimeError("Unable to read message content")
        if not data:
            return None

        raw_bytes, flags, gm_thrid = _imap_fetch_payload(data)

        if not raw_bytes:
            return None

        msg = email_lib.message_from_bytes(raw_bytes)
        subject = _decode_mime(msg.get("Subject", "(sense assumpte)"))
        sender = _decode_mime(msg.get("From", ""))
        to = _decode_mime(msg.get("To", ""))
        cc = _decode_mime(msg.get("Cc", ""))
        date_str = msg.get("Date", "")

        body_text, body_html, attachments, inline_images = _message_content(msg)

        from backend.domains.mail.cache import _set_cached_inline_parts
        from backend.services.mail_inline_images import extract_inline_parts_from_mime

        wanted_cids = {
            str(image["cid"])
            for image in inline_images
            if image.get("cid")
        }
        _set_cached_inline_parts(
            email,
            f"imap_{uid}",
            folder_name,
            extract_inline_parts_from_mime(raw_bytes, wanted_cids),
        )

        message_id_hdr = sanitize_filename_component(msg.get("Message-ID", ""))
        internet_message_id = str(msg.get("Message-ID", "")).strip().strip("<>")
        return {
            "id": f"imap_{uid}",
            "imap_uid": uid,
            "thread_id": gm_thrid or message_id_hdr or f"imap_{uid}",
            "internet_message_id": internet_message_id or None,
            "gm_thrid": gm_thrid,
            "subject": subject,
            "sender": sender,
            "recipient": to,
            "cc": cc,
            "bcc": _decode_mime(msg.get("Bcc", "")),
            "date": date_str,
            "timestamp": _ts(date_str),
            "snippet": (body_text or "")[:200],
            "is_read": "\\seen" in flags,
            "is_starred": "\\flagged" in flags,
            "body_text": body_text,
            "body_html": body_html,
            "has_attachments": bool(attachments) or bool(inline_images),
            "attachments": attachments,
            "inline_images": inline_images,
            "category": "Main",
            "type": _FOLDER_TO_TYPE.get(folder.upper(), "Received"),
            "account": email,
            "source": "imap",
            "imap_folder": folder_name,
        }
    except Exception as error:
        _imap_pool_invalidate(email, message=True)
        raise RuntimeError("Mail content is temporarily unavailable") from error
    finally:
        _imap_pool_release(email, message=True)


# ══════════════════════════════════════════════════════════════════════
# IMAP — COUNTERS
# ══════════════════════════════════════════════════════════════════════


def imap_get_counts(email: str) -> dict[str, Any]:
    acc = _get_imap_account(email)
    if not acc:
        raise RuntimeError("Mail account configuration is unavailable")

    # Folder discovery and several STATUS round trips used to hold the same
    # account connection lock needed by the message list. A short-lived count
    # connection lets the visible list progress independently. The HTTP route
    # coalesces overlapping count reads, and the connection is never retained.
    imap = _imap_connect_fresh(acc)
    if not imap:
        raise RuntimeError("Unable to connect while reading mail folder counts")

    counts: dict[str, Any] = {}
    try:
        from backend.services.imap_mail_sync_service import _discover_folders

        for folder_name, folder_type in _discover_folders(imap, strict=True):
            key = _IMAP_TYPE_TO_KEY.get(folder_type) or (folder_name if folder_type == "Custom" else None)
            if not key:
                continue
            status, data = imap.status(_imap_name(folder_name, always_quote=True), "(MESSAGES UNSEEN)")
            if status != "OK" or not data or not data[0]:
                raise RuntimeError("Unable to read mail folder counts")
            response = data[0].decode("utf-8", errors="replace")
            total = re.search(r"\bMESSAGES (\d+)", response, re.IGNORECASE)
            unread = re.search(r"\bUNSEEN (\d+)", response, re.IGNORECASE)
            if total is None or unread is None:
                raise RuntimeError("Invalid mail folder count response")
            previous = counts.get(key, {"total": 0, "unread": 0})
            counts[key] = {
                "total": previous["total"] + int(total.group(1)),
                "unread": previous["unread"] + int(unread.group(1)),
            }

        if "all" not in counts:
            counts["all"] = {
                field: sum(value[field] for key, value in counts.items() if key not in ("TRASH", "SPAM"))
                for field in ("total", "unread")
            }
        counts["NOT_ARCHIVED"] = counts.get("INBOX", {"total": 0, "unread": 0})
        counts["STARRED"] = {"total": 0, "unread": 0}
    finally:
        try:
            imap.logout()
        except Exception:
            pass

    return counts
