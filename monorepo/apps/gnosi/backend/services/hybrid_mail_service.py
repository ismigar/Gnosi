"""
Hybrid Mail Service — queries the Gmail API and IMAP directly without a vault.
"""
import email as email_lib
import logging
import re
import threading
import imaplib
from email.header import decode_header as _decode_header
from email.utils import parsedate_to_datetime
from typing import Optional

from backend.services.google_mail_service import get_gmail_service
from backend.services.integration_manager import integration_manager
from backend.utils.safe_io import sanitize_filename_component

log = logging.getLogger(__name__)

# ── IMAP connection pool ───────────────────────────────────────────────────────
# A persistent connection per account. Lock per account to prevent concurrent use.
_IMAP_POOL: dict[str, imaplib.IMAP4] = {}
_IMAP_LOCKS: dict[str, threading.Lock] = {}
_IMAP_META = threading.Lock()   # protegeix _IMAP_POOL i _IMAP_LOCKS

_IMAP_TIMEOUT = 20  # seconds

# Last authentication error reason per email. Populated in `_imap_connect_fresh`
# and the endpoints (list/get/counts) read it to return a message
# explanatory if the account fails due to OAuth (vs network/host).
_LAST_AUTH_ERROR: dict[str, str] = {}


def _imap_pool_acquire(acc: dict) -> Optional[imaplib.IMAP4]:
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

# ── Logical folder mapping → Gmail query ────────────────────────────
_GMAIL_FOLDER_QUERY = {
    "INBOX":        "in:inbox",
    "SENT":         "in:sent",
    "DRAFTS":       "in:drafts",
    "TRASH":        "in:trash",
    "SPAM":         "in:spam",
    "STARRED":      "is:starred",
    "all":          "-in:trash -in:spam",
    "NOT_ARCHIVED": "in:inbox",
}

_GMAIL_CATEGORY_QUERY = {
    "Social":     "category:social",
    "Promotions": "category:promotions",
    "Updates":    "category:updates",
    "Forums":     "category:forums",
}

_GMAIL_LABEL_TO_CATEGORY = {
    "CATEGORY_SOCIAL":     "Social",
    "CATEGORY_PROMOTIONS": "Promotions",
    "CATEGORY_UPDATES":    "Updates",
    "CATEGORY_FORUMS":     "Forums",
}

_IMAP_TYPE_TO_KEY = {
    "Received": "INBOX",
    "Sent":     "SENT",
    "Draft":    "DRAFTS",
    "Deleted":  "TRASH",
    "Spam":     "SPAM",
}

_FOLDER_TO_TYPE = {
    "INBOX":  "Received",
    "SENT":   "Sent",
    "DRAFTS": "Draft",
    "TRASH":  "Deleted",
    "SPAM":   "Spam",
}


# ── Helpers ────────────────────────────────────────────────────────────

def _decode_mime(value: str) -> str:
    import html
    if not value:
        return ""
    try:
        parts = _decode_header(value)
    except Exception:
        return str(value)
    out = []
    for part, charset in parts:
        if isinstance(part, bytes):
            codec = charset
            if codec:
                codec = codec.strip().strip('"').strip("'").lower()
                if codec in ("unknown-8bit", "unknown", "x-unknown", "attachment"):
                    codec = "utf-8"
            else:
                codec = "utf-8"
            try:
                out.append(part.decode(codec, errors="replace"))
            except LookupError:
                out.append(part.decode("latin1", errors="replace"))
            except Exception:
                out.append(part.decode("utf-8", errors="replace"))
        else:
            out.append(part)
    return html.unescape("".join(out))


def _ts(date_str: str) -> int:
    try:
        return int(parsedate_to_datetime(date_str).timestamp())
    except Exception:
        return 0


def _get_imap_account(email: str) -> Optional[dict]:
    """Returns the account dict if *email* should be accessed via IMAP.

    Covers: manual (any IMAP), Outlook (injects default host/port), and
    Google OAuth2 (injects imap.gmail.com/smtp.gmail.com and authenticates via
    XOAUTH2 when connecting). Google requires a `refresh_token` saved on the account.
    
    """
    acc = integration_manager.get_mail_account(email)
    if not integration_manager.is_imap_account(acc):
        return None
    return integration_manager.resolve_imap_defaults(acc)


def _imap_connect_fresh(acc: dict) -> Optional[imaplib.IMAP4]:
    host = acc.get("imap_host")
    port = int(acc.get("imap_port") or 993)
    user = acc.get("imap_user") or acc.get("imap_username") or acc.get("email")
    enc  = acc.get("imap_encryption", "ssl").lower()
    if not host or not user:
        log.error(f"[IMAP] Manquen host o user per a {acc.get('email')}")
        return None
    try:
        if enc == "ssl":
            imap = imaplib.IMAP4_SSL(host, port, timeout=_IMAP_TIMEOUT)
        else:
            imap = imaplib.IMAP4(host, port, timeout=_IMAP_TIMEOUT)
            if enc == "starttls":
                imap.starttls()

        if integration_manager.is_imap_oauth_account(acc):
            from backend.services.oauth2_helpers import (
                ensure_fresh_token, xoauth2_imap_login, OAuth2RefreshError,
            )
            email = acc.get("email")
            try:
                access_token, _ = ensure_fresh_token(email)
            except OAuth2RefreshError as e:
                log.error(f"[IMAP-XOAUTH2] Refresh_token caducat per {email}")
                _LAST_AUTH_ERROR[email] = str(e)
                try:
                    imap.logout()
                except Exception:
                    pass
                return None
            if not access_token:
                msg = (
                    f"No s'ha pogut obtenir access_token OAuth2 per a {email}. "
                    f"Comprova les credencials a Configuració."
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
                log.error(f"[IMAP] No password per {user}@{host}")
                try:
                    imap.logout()
                except Exception:
                    pass
                return None
            imap.login(user, pwd)
        return imap
    except Exception as e:
        log.error(f"[IMAP] Connexió fallida per {user}@{host}: {e}")
        return None


def _imap_folder_name(imap, folder_type: str) -> Optional[str]:
    """Returns the real IMAP folder name for a logical type."""
    if folder_type in ("INBOX", "all", "NOT_ARCHIVED", "STARRED"):
        return "INBOX"
    from backend.services.imap_mail_sync_service import _discover_folders, _FOLDER_TYPE_MAP_REVERSE
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

def gmail_list_messages(
    email: str,
    folder: str = "INBOX",
    category: str = None,
    search: str = None,
    limit: int = 50,
    page_token: str = None,
) -> dict:
    service = get_gmail_service(email)
    if not service:
        msg = f"No s'ha pogut connectar amb Gmail per a {email}. Comprova les credencials a Configuració."
        log.error(f"[Gmail] {msg}")
        return {"messages": [], "next_page_token": None, "total": 0, "error": msg}

    q_parts = []
    folder_q = _GMAIL_FOLDER_QUERY.get(folder or "INBOX", "in:inbox")
    if folder_q:
        q_parts.append(folder_q)
    if category:
        cat_q = _GMAIL_CATEGORY_QUERY.get(category, "")
        if cat_q:
            q_parts.append(cat_q)
    if search:
        q_parts.append(search)
    q = " ".join(q_parts)

    try:
        params = {"userId": "me", "maxResults": min(limit, 500), "q": q}
        if page_token:
            params["pageToken"] = page_token
        result = service.users().messages().list(**params).execute()
        msg_ids = [m["id"] for m in result.get("messages", [])]
        next_token = result.get("nextPageToken")
        total = result.get("resultSizeEstimate", len(msg_ids))
    except Exception as e:
        err_str = str(e)
        if "invalid_grant" in err_str or "Token has been expired" in err_str:
            msg = f"El token de Gmail per a {email} ha caducat. Torna a connectar el compte a Configuració."
        else:
            msg = f"Error accedint a Gmail per a {email}: {err_str}"
        log.error(f"[Gmail] {msg}")
        return {"messages": [], "next_page_token": None, "total": 0, "error": msg}

    if not msg_ids:
        return {"messages": [], "next_page_token": None, "total": 0}

    messages = _gmail_batch_metadata(service, email, msg_ids)
    return {"messages": messages, "next_page_token": next_token, "total": total}


def _gmail_batch_metadata(service, account_email: str, msg_ids: list) -> list:
    results = {}

    def cb(request_id, response, exception):
        if exception is None and response:
            results[request_id] = response

    try:
        for i in range(0, len(msg_ids), 100):
            chunk = msg_ids[i:i + 100]
            batch = service.new_batch_http_request(callback=cb)
            for mid in chunk:
                batch.add(
                    service.users().messages().get(
                        userId="me", id=mid, format="metadata",
                        metadataHeaders=["From", "To", "Subject", "Date", "Cc"]
                    ),
                    request_id=mid,
                )
            batch.execute()
    except Exception as e:
        log.error(f"[Gmail] Batch fetch error: {e}")

    return [_parse_gmail_meta(results[mid], account_email) for mid in msg_ids if mid in results]


def _parse_gmail_meta(msg: dict, account_email: str) -> dict:
    headers = {
        h["name"].lower(): h["value"]
        for h in msg.get("payload", {}).get("headers", [])
    }
    label_ids = msg.get("labelIds", [])

    category = "Main"
    for lbl, cat in _GMAIL_LABEL_TO_CATEGORY.items():
        if lbl in label_ids:
            category = cat
            break

    if "SENT" in label_ids:
        msg_type = "Sent"
    elif "DRAFT" in label_ids:
        msg_type = "Draft"
    elif "TRASH" in label_ids:
        msg_type = "Deleted"
    elif "SPAM" in label_ids:
        msg_type = "Spam"
    else:
        msg_type = "Received"

    has_att = bool(msg.get("payload", {}).get("parts") and any(
        p.get("filename") for p in msg["payload"]["parts"]
    ))

    return {
        "id":             msg["id"],
        "thread_id":      msg.get("threadId"),
        "subject":        _decode_mime(headers.get("subject", "(sense assumpte)")),
        "sender":         _decode_mime(headers.get("from", "")),
        "recipient":      _decode_mime(headers.get("to", "")),
        "cc":             _decode_mime(headers.get("cc", "")),
        "date":           headers.get("date", ""),
        "timestamp":      int(msg.get("internalDate", 0)) // 1000,
        "snippet":        _decode_mime(msg.get("snippet", "")),
        "is_read":        "UNREAD" not in label_ids,
        "is_starred":     "STARRED" in label_ids,
        "has_attachments": has_att,
        "category":       category,
        "type":           msg_type,
        "account":        account_email,
        "source":         "gmail",
        "archived":       "INBOX" not in label_ids and msg_type == "Received",
    }


# ══════════════════════════════════════════════════════════════════════
# GMAIL — DETALL
# ══════════════════════════════════════════════════════════════════════

def _extract_gmail_parts(payload: dict) -> tuple:
    """Returns (attachments, inline_images) from a Gmail message payload."""
    import base64
    attachments = []
    inline_images = []

    def _header(part, name):
        for h in part.get("headers", []):
            if h["name"].lower() == name.lower():
                return h["value"]
        return ""

    def _walk(part):
        mime = part.get("mimeType", "")
        body = part.get("body", {})
        att_id = body.get("attachmentId")
        filename = part.get("filename", "")
        size = body.get("size", 0)
        cid_raw = _header(part, "Content-ID")
        cid = cid_raw.strip("<>") if cid_raw else None
        cd = _header(part, "Content-Disposition").lower()

        if att_id:
            if mime.startswith("image/") and "attachment" not in cd:
                # Inline image (with or without CID) — don't show as an attachment
                inline_images.append({
                    "cid": cid or "",
                    "attachment_id": att_id,
                    "content_type": mime,
                    "filename": filename,
                    "size": size,
                })
            elif filename:
                # File with an explicit name (PDF, Word, attached image, etc.)
                attachments.append({
                    "attachment_id": att_id,
                    "filename": filename,
                    "content_type": mime,
                    "size": size,
                })

        for sub in part.get("parts", []):
            _walk(sub)

    _walk(payload)
    return attachments, inline_images


def gmail_get_message(email: str, message_id: str) -> Optional[dict]:
    service = get_gmail_service(email)
    if not service:
        return None
    try:
        raw = service.users().messages().get(
            userId="me", id=message_id, format="full"
        ).execute()
    except Exception as e:
        log.error(f"[Gmail] Error obtenint missatge {message_id}: {e}")
        return None

    meta = _parse_gmail_meta(raw, email)
    payload = raw.get("payload", {})
    body_text, body_html = _extract_gmail_body(payload)
    attachments, inline_images = _extract_gmail_parts(payload)
    meta["body_text"] = body_text
    meta["body_html"] = body_html
    meta["attachments"] = attachments
    meta["inline_images"] = inline_images
    meta["has_attachments"] = bool(attachments) or bool(inline_images)
    return meta


def _extract_gmail_body(payload: dict) -> tuple:
    import base64
    body_text = body_html = ""
    mime = payload.get("mimeType", "")

    if mime == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if data:
            body_text = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
    elif mime == "text/html":
        data = payload.get("body", {}).get("data", "")
        if data:
            body_html = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
    elif "parts" in payload:
        for part in payload["parts"]:
            t, h = _extract_gmail_body(part)
            if t and not body_text:
                body_text = t
            if h and not body_html:
                body_html = h

    return body_text, body_html


# ══════════════════════════════════════════════════════════════════════
# GMAIL — COMPTADORS
# ══════════════════════════════════════════════════════════════════════

_GMAIL_COUNT_LABELS = {
    "INBOX":               "INBOX",
    "SENT":                "SENT",
    "DRAFTS":              "DRAFT",
    "TRASH":               "TRASH",
    "SPAM":                "SPAM",
    "STARRED":             "STARRED",
    "Social":              "CATEGORY_SOCIAL",
    "Promotions":          "CATEGORY_PROMOTIONS",
    "Updates":             "CATEGORY_UPDATES",
    "Forums":              "CATEGORY_FORUMS",
}


def gmail_get_counts(email: str) -> dict:
    service = get_gmail_service(email)
    if not service:
        return {}

    label_ids_wanted = set(_GMAIL_COUNT_LABELS.values())
    label_data = {}

    def cb(request_id, response, exception):
        if exception is None and response:
            label_data[request_id] = response

    try:
        all_labels = service.users().labels().list(userId="me").execute()
        ids_to_fetch = [
            l["id"] for l in all_labels.get("labels", [])
            if l["id"] in label_ids_wanted
        ]
        batch = service.new_batch_http_request(callback=cb)
        for lid in ids_to_fetch:
            batch.add(service.users().labels().get(userId="me", id=lid), request_id=lid)
        batch.execute()
    except Exception as e:
        log.error(f"[Gmail] Error obtenint counts per {email}: {e}")
        return {}

    counts = {}
    for key, lid in _GMAIL_COUNT_LABELS.items():
        if lid in label_data:
            counts[key] = {
                "total":  label_data[lid].get("messagesTotal", 0),
                "unread": label_data[lid].get("messagesUnread", 0),
            }

    counts["all"] = counts.get("INBOX", {"total": 0, "unread": 0})
    counts["NOT_ARCHIVED"] = counts.get("INBOX", {"total": 0, "unread": 0})
    return counts


# ══════════════════════════════════════════════════════════════════════
# IMAP — LIST
# ══════════════════════════════════════════════════════════════════════

def imap_list_messages(
    email: str,
    folder: str = "INBOX",
    search: str = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    acc = _get_imap_account(email)
    if not acc:
        msg = f"No s'ha trobat configuració IMAP per a {email}."
        log.error(f"[IMAP] {msg}")
        return {"messages": [], "total": 0, "error": msg}

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

        if folder == "STARRED":
            criteria = "FLAGGED"
        elif search:
            criteria = f'TEXT "{search}"'
        else:
            criteria = "ALL"

        status, data = imap.uid("search", None, criteria)
        if status != "OK" or not data[0]:
            return {"messages": [], "total": 0}

        all_uids = data[0].split()
        total = len(all_uids)

        # Newest first: we take from the end
        start = max(0, total - offset - limit)
        end   = max(0, total - offset)
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

        messages = []
        for i, part in enumerate(fetch_data):
            if not isinstance(part, tuple):
                continue
            # Servers like Gmail return FETCH attributes (FLAGS, X-GM-THRID)
            # after the RFC822.HEADER literal — i.e. in the trailing bytes
            # element that follows the tuple. Combine head + tail so the
            # regexes below find them regardless of the server's order.
            info_head = part[0].decode("utf-8", errors="replace")
            tail = ""
            if i + 1 < len(fetch_data) and isinstance(fetch_data[i + 1], (bytes, bytearray)):
                tail = bytes(fetch_data[i + 1]).decode("utf-8", errors="replace")
            info = info_head + " " + tail
            uid_m = re.search(r'UID (\d+)', info, re.IGNORECASE)
            uid = uid_m.group(1) if uid_m else None
            if not uid:
                continue
            flags_m = re.search(r'FLAGS \(([^)]*)\)', info, re.IGNORECASE)
            flags = (flags_m.group(1) if flags_m else "").lower()
            thrid_m = re.search(r"X-GM-THRID (\d+)", info)
            gm_thrid = thrid_m.group(1) if thrid_m else None

            msg = email_lib.message_from_bytes(part[1])
            subject = _decode_mime(msg.get("Subject", "(sense assumpte)"))
            sender  = _decode_mime(msg.get("From", ""))
            to      = _decode_mime(msg.get("To", ""))
            cc      = _decode_mime(msg.get("Cc", ""))
            date_str = msg.get("Date", "")
            message_id_hdr = sanitize_filename_component(msg.get("Message-ID", ""))

            messages.append({
                "id":             f"imap_{uid}",
                "imap_uid":       uid,
                "thread_id":      gm_thrid or message_id_hdr or f"imap_{uid}",
                "gm_thrid":       gm_thrid,
                "subject":        subject,
                "sender":         sender,
                "recipient":      to,
                "cc":             cc,
                "date":           date_str,
                "timestamp":      _ts(date_str),
                "snippet":        "",
                "is_read":        "\\seen" in flags,
                "is_starred":     "\\flagged" in flags,
                "has_attachments": False,
                "category":       "Main",
                "type":           _FOLDER_TO_TYPE.get(folder.upper(), "Received"),
                "account":        email,
                "source":         "imap",
                "imap_folder":    folder_name,
            })

        return {"messages": messages, "total": total}
    except Exception:
        _imap_pool_invalidate(email)
        raise
    finally:
        _imap_pool_release(email)


# ══════════════════════════════════════════════════════════════════════
# IMAP — DETALL
# ══════════════════════════════════════════════════════════════════════

def imap_get_message(email: str, uid: str, folder: str = "INBOX") -> Optional[dict]:
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

        raw_bytes = None
        flags = ""
        gm_thrid = None
        for part in data:
            if isinstance(part, tuple):
                info = part[0].decode("utf-8", errors="replace")
                flags_m = re.search(r'FLAGS \(([^)]*)\)', info, re.IGNORECASE)
                if flags_m:
                    flags = flags_m.group(1).lower()
                thrid_m = re.search(r"X-GM-THRID (\d+)", info)
                if thrid_m:
                    gm_thrid = thrid_m.group(1)
                raw_bytes = part[1]
                break

        if not raw_bytes:
            return None

        msg = email_lib.message_from_bytes(raw_bytes)
        subject  = _decode_mime(msg.get("Subject", "(sense assumpte)"))
        sender   = _decode_mime(msg.get("From", ""))
        to       = _decode_mime(msg.get("To", ""))
        cc       = _decode_mime(msg.get("Cc", ""))
        date_str = msg.get("Date", "")

        body_text = body_html = ""
        attachments = []
        inline_images = []
        if msg.is_multipart():
            for i, part in enumerate(msg.walk()):
                ct = part.get_content_type()
                cd = part.get("Content-Disposition", "")
                cid_raw = part.get("Content-ID", "")
                cid = cid_raw.strip("<>") if cid_raw else None
                filename = part.get_filename()
                if filename:
                    filename = _decode_mime(filename)
                payload = part.get_payload(decode=True)

                # Inline image with CID (signature images, etc.)
                if cid and ct.startswith("image/"):
                    inline_images.append({
                        "part_index": i,
                        "cid": cid,
                        "content_type": ct,
                        "size": len(payload) if payload else 0,
                    })
                    continue

                # Regular attachment
                if filename and "attachment" in cd.lower():
                    attachments.append({
                        "part_index": i,
                        "filename": filename,
                        "content_type": ct,
                        "size": len(payload) if payload else 0,
                    })
                    continue

                if not payload:
                    continue
                charset = part.get_content_charset() or "utf-8"
                if isinstance(charset, str):
                    charset = charset.strip().strip('"').strip("'").lower()
                    if charset in ("unknown-8bit", "unknown", "x-unknown", "attachment"):
                        charset = "utf-8"
                try:
                    text_decoded = payload.decode(charset, errors="replace")
                except LookupError:
                    text_decoded = payload.decode("latin1", errors="replace")
                except Exception:
                    text_decoded = payload.decode("utf-8", errors="replace")

                if ct == "text/plain" and not body_text:
                    body_text = text_decoded
                elif ct == "text/html" and not body_html:
                    body_html = text_decoded
        else:
            payload = msg.get_payload(decode=True)
            if payload:
                charset = msg.get_content_charset() or "utf-8"
                if isinstance(charset, str):
                    charset = charset.strip().strip('"').strip("'").lower()
                    if charset in ("unknown-8bit", "unknown", "x-unknown", "attachment"):
                        charset = "utf-8"
                try:
                    text_decoded = payload.decode(charset, errors="replace")
                except LookupError:
                    text_decoded = payload.decode("latin1", errors="replace")
                except Exception:
                    text_decoded = payload.decode("utf-8", errors="replace")

                if msg.get_content_type() == "text/html":
                    body_html = text_decoded
                else:
                    body_text = text_decoded

        message_id_hdr = sanitize_filename_component(msg.get("Message-ID", ""))
        return {
            "id":              f"imap_{uid}",
            "imap_uid":        uid,
            "thread_id":       gm_thrid or message_id_hdr or f"imap_{uid}",
            "gm_thrid":        gm_thrid,
            "subject":         subject,
            "sender":          sender,
            "recipient":       to,
            "cc":              cc,
            "date":            date_str,
            "timestamp":       _ts(date_str),
            "snippet":         (body_text or "")[:200],
            "is_read":         "\\seen" in flags,
            "is_starred":      "\\flagged" in flags,
            "body_text":       body_text,
            "body_html":       body_html,
            "has_attachments": bool(attachments) or bool(inline_images),
            "attachments":     attachments,
            "inline_images":   inline_images,
            "category":        "Main",
            "type":            _FOLDER_TO_TYPE.get(folder.upper(), "Received"),
            "account":         email,
            "source":          "imap",
            "imap_folder":     folder_name,
        }
    except Exception:
        _imap_pool_invalidate(email)
        return None
    finally:
        _imap_pool_release(email)


# ══════════════════════════════════════════════════════════════════════
# IMAP — COMPTADORS
# ══════════════════════════════════════════════════════════════════════

def imap_get_counts(email: str) -> dict:
    acc = _get_imap_account(email)
    if not acc:
        return {}

    imap = _imap_pool_acquire(acc)
    if not imap:
        return {}

    counts = {}
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
                        r'MESSAGES (\d+).*?UNSEEN (\d+)',
                        data[0].decode("utf-8", errors="replace"),
                        re.IGNORECASE,
                    )
                    if m:
                        counts[key] = {
                            "total":  int(m.group(1)),
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
