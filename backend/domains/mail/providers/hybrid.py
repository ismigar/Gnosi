"""
Hybrid Mail Service — queries the Gmail API and IMAP directly without a vault.
"""

import email as email_lib
import imaplib
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

log = logging.getLogger(__name__)

# ── IMAP connection pool ───────────────────────────────────────────────────────
# A persistent connection per account. Lock per account to prevent concurrent use.
_IMAP_POOL: dict[str, imaplib.IMAP4] = {}
_IMAP_LOCKS: dict[str, threading.Lock] = {}
_IMAP_META = threading.Lock()  # Protects _IMAP_POOL and _IMAP_LOCKS.

_IMAP_TIMEOUT = 20  # seconds

# Last authentication error reason per email. Populated in `_imap_connect_fresh`
# and the endpoints (list/get/counts) read it to return a message
# explanatory if the account fails due to OAuth (vs network/host).
_LAST_AUTH_ERROR: dict[str, str] = {}


def _imap_pool_acquire(acc: dict[str, Any]) -> Optional[imaplib.IMAP4]:
    """Returns an IMAP connection from the pool, reconnecting if needed.
    The caller must release it by calling _imap_pool_release(email)."""
    email = acc.get("email") or acc.get("imap_user")
    if not email:
        return None

    with _IMAP_META:
        if email not in _IMAP_LOCKS:
            _IMAP_LOCKS[email] = threading.Lock()

    lock = _IMAP_LOCKS[email]
    lock.acquire()

    imap = _IMAP_POOL.get(email)
    if imap:
        try:
            imap.noop()
        except Exception:
            imap = None
            _IMAP_POOL.pop(email, None)

    if not imap:
        imap = _imap_connect_fresh(acc)
        if imap:
            _IMAP_POOL[email] = imap
        else:
            lock.release()
            return None

    return imap


def _imap_pool_release(email: str) -> None:
    """Releases the account lock so other requests can use the connection."""
    lock = _IMAP_LOCKS.get(email)
    if lock and lock.locked():
        try:
            lock.release()
        except RuntimeError:
            pass


def _imap_pool_invalidate(email: str) -> None:
    """Removes the connection from the pool (used when a serious error is detected)."""
    with _IMAP_META:
        conn = _IMAP_POOL.pop(email, None)
    if conn:
        try:
            conn.logout()
        except Exception:
            pass


_IMAP_TYPE_TO_KEY = {
    "Received": "INBOX",
    "Sent": "SENT",
    "Draft": "DRAFTS",
    "Deleted": "TRASH",
    "Spam": "SPAM",
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


def _imap_folder_name(imap: Any, folder_type: str) -> Optional[str]:
    """Returns the real IMAP folder name for a logical type."""
    if folder_type in ("INBOX", "all", "NOT_ARCHIVED", "STARRED"):
        return "INBOX"
    from backend.services.imap_mail_sync_service import _FOLDER_TYPE_MAP_REVERSE, _discover_folders

    wanted_type = _FOLDER_TYPE_MAP_REVERSE.get(folder_type)
    if not wanted_type:
        return "INBOX"
    for name, ftype in _discover_folders(imap):
        if ftype == wanted_type:
            return name
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
    if folder == "STARRED":
        return "FLAGGED"
    return f'TEXT "{search}"' if search else "ALL"


def _imap_list_item(
    fetch_data: list[Any], index: int, folder: str, account_email: str, folder_name: str
) -> dict[str, Any] | None:
    part = fetch_data[index]
    if not isinstance(part, tuple):
        return None
    info_head = part[0].decode("utf-8", errors="replace")
    next_part = fetch_data[index + 1] if index + 1 < len(fetch_data) else None
    tail = (
        bytes(next_part).decode("utf-8", errors="replace")
        if isinstance(next_part, (bytes, bytearray))
        else ""
    )
    info = info_head + " " + tail
    uid_match = re.search(r"UID (\d+)", info, re.IGNORECASE)
    if not uid_match:
        return None
    uid = uid_match.group(1)
    flags_match = re.search(r"FLAGS \(([^)]*)\)", info, re.IGNORECASE)
    flags = (flags_match.group(1) if flags_match else "").lower()
    thread_match = re.search(r"X-GM-THRID (\d+)", info)
    gmail_thread_id = thread_match.group(1) if thread_match else None
    msg = email_lib.message_from_bytes(part[1])
    date_str = msg.get("Date", "")
    message_id = sanitize_filename_component(msg.get("Message-ID", ""))
    return {
        "id": f"imap_{uid}",
        "imap_uid": uid,
        "thread_id": gmail_thread_id or message_id or f"imap_{uid}",
        "gm_thrid": gmail_thread_id,
        "subject": _decode_mime(msg.get("Subject", "(sense assumpte)")),
        "sender": _decode_mime(msg.get("From", "")),
        "recipient": _decode_mime(msg.get("To", "")),
        "cc": _decode_mime(msg.get("Cc", "")),
        "date": date_str,
        "timestamp": _ts(date_str),
        "snippet": "",
        "is_read": "\\seen" in flags,
        "is_starred": "\\flagged" in flags,
        "has_attachments": False,
        "category": "Main",
        "type": _FOLDER_TO_TYPE.get(folder.upper(), "Received"),
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
        return {"messages": [], "total": 0}

    try:
        folder_name = _imap_folder_name(imap, folder)
        if not folder_name:
            return {"messages": [], "total": 0}

        status, _ = imap.select(f'"{folder_name}"', readonly=True)
        if status != "OK":
            return {"messages": [], "total": 0}

        no_charset: Any = None
        status, data = imap.uid("search", no_charset, _imap_search_criteria(folder, search))
        if status != "OK" or not data[0]:
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
        is_gmail = integration_manager.is_imap_oauth_account(acc)
        fetch_args = "(FLAGS X-GM-THRID RFC822.HEADER)" if is_gmail else "(FLAGS RFC822.HEADER)"
        status, fetch_data = imap.uid("fetch", uid_str, fetch_args)
        if status != "OK":
            return {"messages": [], "total": total}

        messages = [
            item
            for index in range(len(fetch_data))
            if (item := _imap_list_item(fetch_data, index, folder, email, folder_name)) is not None
        ]

        return {"messages": messages, "total": total}
    except Exception:
        _imap_pool_invalidate(email)
        raise
    finally:
        _imap_pool_release(email)


# ══════════════════════════════════════════════════════════════════════
# IMAP — DETAILS
# ══════════════════════════════════════════════════════════════════════


def _imap_fetch_payload(data: list[Any]) -> tuple[bytes | None, str, str | None]:
    for part in data:
        if not isinstance(part, tuple):
            continue
        info = part[0].decode("utf-8", errors="replace")
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
    acc = _get_imap_account(email)
    if not acc:
        return None

    imap = _imap_pool_acquire(acc)
    if not imap:
        return None

    try:
        folder_name = _imap_folder_name(imap, folder)
        if not folder_name:
            return None

        status, _ = imap.select(f'"{folder_name}"', readonly=True)
        if status != "OK":
            return None

        is_gmail = integration_manager.is_imap_oauth_account(acc)
        fetch_args = "(FLAGS X-GM-THRID BODY[])" if is_gmail else "(FLAGS BODY[])"
        status, data = imap.uid("fetch", uid, fetch_args)
        if status != "OK" or not data:
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
        return {
            "id": f"imap_{uid}",
            "imap_uid": uid,
            "thread_id": gm_thrid or message_id_hdr or f"imap_{uid}",
            "gm_thrid": gm_thrid,
            "subject": subject,
            "sender": sender,
            "recipient": to,
            "cc": cc,
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
    except Exception:
        _imap_pool_invalidate(email)
        return None
    finally:
        _imap_pool_release(email)


# ══════════════════════════════════════════════════════════════════════
# IMAP — COUNTERS
# ══════════════════════════════════════════════════════════════════════


def imap_get_counts(email: str) -> dict[str, Any]:
    acc = _get_imap_account(email)
    if not acc:
        return {}

    imap = _imap_pool_acquire(acc)
    if not imap:
        return {}

    counts: dict[str, Any] = {}
    try:
        from backend.services.imap_mail_sync_service import _discover_folders

        for folder_name, folder_type in _discover_folders(imap):
            key = _IMAP_TYPE_TO_KEY.get(folder_type)
            if not key:
                continue
            try:
                status, data = imap.status(f'"{folder_name}"', "(MESSAGES UNSEEN)")
                if status == "OK" and data and data[0]:
                    m = re.search(
                        r"MESSAGES (\d+).*?UNSEEN (\d+)",
                        data[0].decode("utf-8", errors="replace"),
                        re.IGNORECASE,
                    )
                    if m:
                        counts[key] = {
                            "total": int(m.group(1)),
                            "unread": int(m.group(2)),
                        }
            except Exception:
                pass

        counts["all"] = counts.get("INBOX", {"total": 0, "unread": 0})
        counts["NOT_ARCHIVED"] = counts.get("INBOX", {"total": 0, "unread": 0})
        counts["STARRED"] = {"total": 0, "unread": 0}
    except Exception:
        _imap_pool_invalidate(email)
    finally:
        _imap_pool_release(email)

    return counts
