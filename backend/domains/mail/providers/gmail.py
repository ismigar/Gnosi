"""Gmail API adapter for the mail domain."""

from __future__ import annotations

import logging
from typing import Any

from backend.services.google_mail_service import get_gmail_service

from .common import _decode_mime

log = logging.getLogger(__name__)

_GMAIL_FOLDER_QUERY = {
    "INBOX": "in:inbox",
    "SENT": "in:sent",
    "DRAFTS": "in:drafts",
    "TRASH": "in:trash",
    "SPAM": "in:spam",
    "STARRED": "is:starred",
    "all": "-in:trash -in:spam",
    "NOT_ARCHIVED": "in:inbox",
}


_GMAIL_CATEGORY_QUERY = {
    "Social": "category:social",
    "Promotions": "category:promotions",
    "Updates": "category:updates",
    "Forums": "category:forums",
}


_GMAIL_LABEL_TO_CATEGORY = {
    "CATEGORY_SOCIAL": "Social",
    "CATEGORY_PROMOTIONS": "Promotions",
    "CATEGORY_UPDATES": "Updates",
    "CATEGORY_FORUMS": "Forums",
}


def gmail_list_messages(
    email: str,
    folder: str = "INBOX",
    category: str | None = None,
    search: str | None = None,
    limit: int = 50,
    page_token: str | None = None,
) -> dict[str, Any]:
    service = get_gmail_service(email)
    if not service:
        msg = f"Could not connect to Gmail for {email}. Check the credentials in Settings."
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
            msg = (
                f"El token de Gmail per a {email} ha caducat. "
                "Torna a connectar el compte a Configuració."
            )
        else:
            msg = f"Error accedint a Gmail per a {email}: {err_str}"
        log.error(f"[Gmail] {msg}")
        return {"messages": [], "next_page_token": None, "total": 0, "error": msg}

    if not msg_ids:
        return {"messages": [], "next_page_token": None, "total": 0}

    messages = _gmail_batch_metadata(service, email, msg_ids)
    return {"messages": messages, "next_page_token": next_token, "total": total}


def _gmail_batch_metadata(service: Any, account_email: str, msg_ids: list[Any]) -> list[Any]:
    results = {}

    def cb(request_id: Any, response: Any, exception: Any) -> Any:
        if exception is None and response:
            results[request_id] = response

    try:
        for i in range(0, len(msg_ids), 100):
            chunk = msg_ids[i : i + 100]
            batch = service.new_batch_http_request(callback=cb)
            for mid in chunk:
                batch.add(
                    service.users()
                    .messages()
                    .get(
                        userId="me",
                        id=mid,
                        format="metadata",
                        metadataHeaders=["From", "To", "Subject", "Date", "Cc", "Message-ID"],
                    ),
                    request_id=mid,
                )
            batch.execute()
    except Exception as e:
        log.error(f"[Gmail] Batch fetch error: {e}")

    return [_parse_gmail_meta(results[mid], account_email) for mid in msg_ids if mid in results]


def _parse_gmail_meta(msg: dict[str, Any], account_email: str) -> dict[str, Any]:
    headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
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

    has_att = bool(
        msg.get("payload", {}).get("parts")
        and any(p.get("filename") for p in msg["payload"]["parts"])
    )

    return {
        "id": msg["id"],
        "thread_id": msg.get("threadId"),
        "internet_message_id": headers.get("message-id") or None,
        "subject": _decode_mime(headers.get("subject", "(sense assumpte)")),
        "sender": _decode_mime(headers.get("from", "")),
        "recipient": _decode_mime(headers.get("to", "")),
        "cc": _decode_mime(headers.get("cc", "")),
        "date": headers.get("date", ""),
        "timestamp": int(msg.get("internalDate", 0)) // 1000,
        "snippet": _decode_mime(msg.get("snippet", "")),
        "is_read": "UNREAD" not in label_ids,
        "is_starred": "STARRED" in label_ids,
        "has_attachments": has_att,
        "category": category,
        "type": msg_type,
        "account": account_email,
        "source": "gmail",
        "archived": "INBOX" not in label_ids and msg_type == "Received",
    }


def _extract_gmail_parts(payload: dict[str, Any]) -> tuple[Any, ...]:
    """Returns (attachments, inline_images) from a Gmail message payload."""
    attachments = []
    inline_images = []

    def _header(part: Any, name: Any) -> Any:
        for h in part.get("headers", []):
            if h["name"].lower() == name.lower():
                return h["value"]
        return ""

    def _walk(part: Any) -> Any:
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
                inline_images.append(
                    {
                        "cid": cid or "",
                        "attachment_id": att_id,
                        "content_type": mime,
                        "filename": filename,
                        "size": size,
                    }
                )
            elif filename:
                # File with an explicit name (PDF, Word, attached image, etc.)
                attachments.append(
                    {
                        "attachment_id": att_id,
                        "filename": filename,
                        "content_type": mime,
                        "size": size,
                    }
                )

        for sub in part.get("parts", []):
            _walk(sub)

    _walk(payload)
    return attachments, inline_images


def gmail_get_message(email: str, message_id: str) -> dict[str, Any] | None:
    service = get_gmail_service(email)
    if not service:
        return None
    try:
        raw = service.users().messages().get(userId="me", id=message_id, format="full").execute()
    except Exception as e:
        log.error(f"[Gmail] Failed to retrieve message {message_id}: {e}")
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


def _extract_gmail_body(payload: dict[str, Any]) -> tuple[Any, ...]:
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


_GMAIL_COUNT_LABELS = {
    "INBOX": "INBOX",
    "SENT": "SENT",
    "DRAFTS": "DRAFT",
    "TRASH": "TRASH",
    "SPAM": "SPAM",
    "STARRED": "STARRED",
    "Social": "CATEGORY_SOCIAL",
    "Promotions": "CATEGORY_PROMOTIONS",
    "Updates": "CATEGORY_UPDATES",
    "Forums": "CATEGORY_FORUMS",
}


def gmail_get_counts(email: str) -> dict[str, Any]:
    service = get_gmail_service(email)
    if not service:
        return {}

    label_ids_wanted = set(_GMAIL_COUNT_LABELS.values())
    label_data = {}

    def cb(request_id: Any, response: Any, exception: Any) -> Any:
        if exception is None and response:
            label_data[request_id] = response

    try:
        all_labels = service.users().labels().list(userId="me").execute()
        ids_to_fetch = [
            label["id"] for label in all_labels.get("labels", []) if label["id"] in label_ids_wanted
        ]
        batch = service.new_batch_http_request(callback=cb)
        for lid in ids_to_fetch:
            batch.add(service.users().labels().get(userId="me", id=lid), request_id=lid)
        batch.execute()
    except Exception as e:
        log.error(f"[Gmail] Failed to retrieve counts for {email}: {e}")
        return {}

    counts = {}
    for key, lid in _GMAIL_COUNT_LABELS.items():
        if lid in label_data:
            counts[key] = {
                "total": label_data[lid].get("messagesTotal", 0),
                "unread": label_data[lid].get("messagesUnread", 0),
            }

    counts["all"] = counts.get("INBOX", {"total": 0, "unread": 0})
    counts["NOT_ARCHIVED"] = counts.get("INBOX", {"total": 0, "unread": 0})
    return counts
