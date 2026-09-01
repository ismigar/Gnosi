"""Microsoft Graph API mail service.

Provides the same interface as google_mail_service / hybrid_mail_service
so the dispatch layer (mail_routes, hybrid_mail_service) can treat it
uniformly.

Token refresh is handled transparently: if the access token is expired
the refresh_token is used and the new token is persisted via
integration_manager.update_mail_account_token().
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import requests as http

from backend.services.mail_inline_images import InlineImage, MimeAsset

log = logging.getLogger(__name__)

GRAPH = "https://graph.microsoft.com/v1.0"
TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"

# Graph folder id → logical key used throughout Gnosi
_WELL_KNOWN_FOLDERS = {
    "inbox": "INBOX",
    "sentitems": "SENT",
    "drafts": "DRAFTS",
    "deleteditems": "TRASH",
    "junkemail": "SPAM",
    "archive": "ARCHIVE",
}
_GNOSI_TO_GRAPH = {v: k for k, v in _WELL_KNOWN_FOLDERS.items()}
_GNOSI_TO_GRAPH["all"] = "inbox"  # fallback

_MSG_SELECT = ",".join(
    [
        "id",
        "subject",
        "from",
        "toRecipients",
        "ccRecipients",
        "receivedDateTime",
        "sentDateTime",
        "isRead",
        "flag",
        "hasAttachments",
        "bodyPreview",
        "parentFolderId",
        "isDraft",
        "isDeleted",
    ]
)


# ── Token management ───────────────────────────────────────────────────────────


def _refresh_token(account: dict[str, Any]) -> str | None:
    """Refreshes the access token using the refresh_token.  Returns new token or None."""
    from backend.services.integration_manager import integration_manager

    try:
        resp = http.post(
            TOKEN_URL,
            data={
                "client_id": account.get("client_id"),
                "client_secret": account.get("client_secret"),
                "refresh_token": account.get("refresh_token"),
                "grant_type": "refresh_token",
                "scope": "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access User.Read",
            },
            timeout=15,
        )
        resp.raise_for_status()
        raw_token = resp.json().get("access_token")
        new_token = raw_token if isinstance(raw_token, str) else None
        if new_token:
            email = account.get("email", "")
            integration_manager.update_mail_account_token(email, new_token)
            log.info(f"[Microsoft] Token renewed for {email}")
        return new_token
    except Exception as e:
        log.error(f"[Microsoft] Failed to refresh token: {e}")
        return None


def _get_token(email: str) -> str | None:
    """Returns a valid access token, refreshing if necessary."""
    from backend.services.integration_manager import integration_manager

    account = integration_manager.get_mail_account(email)
    if not account:
        return None
    token = account.get("token")
    if not token:
        return _refresh_token(account)
    return token if isinstance(token, str) else None


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _graph(method: str, path: str, token: str, **kwargs: Any) -> http.Response:
    """Wrapper around requests that retries once after a 401 with a refreshed token."""
    request: Any = getattr(http, method)
    resp: http.Response = request(f"{GRAPH}{path}", headers=_headers(token), **kwargs)
    return resp


def _authed_get(email: str, path: str, **kwargs: Any) -> dict[str, Any] | None:
    """GET with automatic token refresh on 401."""
    from backend.services.integration_manager import integration_manager

    account = integration_manager.get_mail_account(email)
    if not account:
        return None
    token = account.get("token")
    if not isinstance(token, str):
        token = _refresh_token(account)
    if not token:
        return None
    resp = _graph("get", path, token, **kwargs)
    if resp.status_code == 401 and account.get("refresh_token"):
        token = _refresh_token(account)
        if token:
            resp = _graph("get", path, token, **kwargs)
    if not resp.ok:
        log.error(f"[Microsoft] GET {path} → {resp.status_code}: {resp.text[:200]}")
        return None
    payload = resp.json()
    return payload if isinstance(payload, dict) else None


def _authed_post(
    email: str,
    path: str,
    json_body: dict[str, Any],
    **kwargs: Any,
) -> bool:
    """POST with automatic token refresh on 401."""
    from backend.services.integration_manager import integration_manager

    account = integration_manager.get_mail_account(email)
    if not account:
        return False
    token = account.get("token")
    if not isinstance(token, str):
        token = _refresh_token(account)
    if not token:
        return False
    resp = _graph("post", path, token, json=json_body, **kwargs)
    if resp.status_code == 401 and account.get("refresh_token"):
        token = _refresh_token(account)
        if token:
            resp = _graph("post", path, token, json=json_body, **kwargs)
    if not resp.ok:
        log.error(f"[Microsoft] POST {path} → {resp.status_code}: {resp.text[:200]}")
        return False
    return True


def _authed_patch(email: str, path: str, json_body: dict[str, Any]) -> bool:
    """PATCH with automatic token refresh on 401."""
    from backend.services.integration_manager import integration_manager

    account = integration_manager.get_mail_account(email)
    if not account:
        return False
    token = account.get("token")
    if not isinstance(token, str):
        token = _refresh_token(account)
    if not token:
        return False
    resp = _graph("patch", path, token, json=json_body)
    if resp.status_code == 401 and account.get("refresh_token"):
        token = _refresh_token(account)
        if token:
            resp = _graph("patch", path, token, json=json_body)
    if not resp.ok:
        log.error(f"[Microsoft] PATCH {path} → {resp.status_code}: {resp.text[:200]}")
        return False
    return True


# ── Parsers ────────────────────────────────────────────────────────────────────


def _ts(date_str: str) -> int:
    if not date_str:
        return 0
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        return int(dt.timestamp())
    except Exception:
        return 0


def _parse_message(msg: dict[str, Any], account_email: str) -> dict[str, Any]:
    sender_obj = msg.get("from", {}).get("emailAddress", {})
    sender = f"{sender_obj.get('name', '')} <{sender_obj.get('address', '')}>".strip()

    def _addrs(field: str) -> str:
        return ", ".join(
            f"{r['emailAddress'].get('name', '')} <{r['emailAddress'].get('address', '')}>".strip()
            for r in msg.get(field, [])
        )

    flag_status = msg.get("flag", {}).get("flagStatus", "notFlagged")
    date_str = msg.get("receivedDateTime") or msg.get("sentDateTime", "")

    # Determine type from parentFolderId display name or isDraft
    msg_type = "Received"
    if msg.get("isDraft"):
        msg_type = "Draft"

    return {
        "id": msg["id"],
        "thread_id": msg.get("conversationId", msg["id"]),
        "subject": msg.get("subject") or "(sense assumpte)",
        "sender": sender,
        "recipient": _addrs("toRecipients"),
        "cc": _addrs("ccRecipients"),
        "date": date_str,
        "timestamp": _ts(date_str),
        "snippet": msg.get("bodyPreview", ""),
        "is_read": msg.get("isRead", True),
        "is_starred": flag_status == "flagged",
        "has_attachments": msg.get("hasAttachments", False),
        "category": "Main",
        "type": msg_type,
        "account": account_email,
        "source": "microsoft",
        "archived": False,
        "_folder_id": msg.get("parentFolderId", ""),
    }


# ── Public API ─────────────────────────────────────────────────────────────────


def microsoft_list_messages(
    email: str,
    folder: str = "INBOX",
    category: str | None = None,
    search: str | None = None,
    limit: int = 50,
    page_token: str | None = None,
) -> dict[str, Any]:
    graph_folder = _GNOSI_TO_GRAPH.get(folder.upper() if folder else "INBOX", "inbox")

    params: dict[str, object] = {
        "$top": min(limit, 100),
        "$select": _MSG_SELECT,
        "$orderby": "receivedDateTime desc",
    }
    if search:
        params["$search"] = f'"{search}"'
    if page_token:
        params["$skiptoken"] = page_token

    if folder and folder.upper() == "ALL":
        path = "/me/messages"
    else:
        path = f"/me/mailFolders/{graph_folder}/messages"

    data = _authed_get(email, path, params=params)
    if data is None:
        msg = f"Could not connect to Microsoft 365 for {email}. Check the credentials."
        return {"messages": [], "next_page_token": None, "total": 0, "error": msg}

    messages = [_parse_message(m, email) for m in data.get("value", [])]

    # Extract skip token from @odata.nextLink
    next_link = data.get("@odata.nextLink", "")
    next_token = None
    if next_link and "$skiptoken=" in next_link:
        next_token = next_link.split("$skiptoken=")[-1].split("&")[0]

    return {
        "messages": messages,
        "next_page_token": next_token,
        "total": len(messages),
    }


def microsoft_get_message(email: str, message_id: str) -> dict[str, Any] | None:
    data = _authed_get(
        email,
        f"/me/messages/{message_id}",
        params={"$select": _MSG_SELECT + ",body"},
    )
    if not data:
        return None
    parsed = _parse_message(data, email)
    body = data.get("body", {})
    if body.get("contentType") == "html":
        parsed["body_html"] = body.get("content", "")
        parsed["body_text"] = ""
    else:
        parsed["body_text"] = body.get("content", "")
        parsed["body_html"] = None
    return parsed


def microsoft_get_inline_parts(
    email: str, message_id: str, wanted_cids: set[str]
) -> dict[str, MimeAsset]:
    """Retrieves a message's inline attachments by Content-ID via Graph.

    Args:
        wanted_cids: Content-IDs to look up (with or without ``<>``).

    Returns:
        Dict cid (without ``<>``) → {filename, content_type, data}. Empty if the
        message or attachments can't be retrieved (never raises).

    """
    import base64

    wanted = {c.strip("<>") for c in wanted_cids if c}
    if not wanted:
        return {}
    data = _authed_get(email, f"/me/messages/{message_id}/attachments")
    if not data:
        return {}
    parts: dict[str, MimeAsset] = {}
    for att in data.get("value", []):
        cid = (att.get("contentId") or "").strip("<>")
        content_bytes = att.get("contentBytes")
        if not cid or cid not in wanted or cid in parts or not content_bytes:
            continue
        try:
            raw = base64.b64decode(content_bytes)
        except Exception:
            log.warning(f"[Microsoft] Invalid contentBytes for CID {cid} in {message_id}")
            continue
        if raw:
            parts[cid] = {
                "filename": att.get("name") or "image",
                "content_type": att.get("contentType") or "application/octet-stream",
                "data": raw,
            }
    return parts


def microsoft_get_counts(email: str) -> dict[str, dict[str, int]]:
    data = _authed_get(email, "/me/mailFolders", params={"$top": 20})
    if not data:
        return {}
    counts: dict[str, dict[str, int]] = {}
    for folder in data.get("value", []):
        key = _WELL_KNOWN_FOLDERS.get(folder.get("wellKnownName", "").lower())
        if key:
            counts[key] = {
                "total": folder.get("totalItemCount", 0),
                "unread": folder.get("unreadItemCount", 0),
            }
    counts["all"] = counts.get("INBOX", {"total": 0, "unread": 0})
    counts["NOT_ARCHIVED"] = counts.get("INBOX", {"total": 0, "unread": 0})
    return counts


def _graph_attachments(
    attachments: list[MimeAsset] | None = None,
    inline_images: list[InlineImage] | None = None,
) -> list[dict[str, Any]]:
    """Maps attachments {filename, content_type, data} and inline images
    {…, content_id} to Microsoft Graph's fileAttachment format."""
    import base64

    out: list[dict[str, Any]] = []
    for att in attachments or []:
        out.append(
            {
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": att.get("filename") or "attachment",
                "contentType": att.get("content_type") or "application/octet-stream",
                "contentBytes": base64.b64encode(att["data"]).decode(),
            }
        )
    for img in inline_images or []:
        out.append(
            {
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": img.get("filename") or "image",
                "contentType": img.get("content_type") or "application/octet-stream",
                "contentBytes": base64.b64encode(img["data"]).decode(),
                "contentId": img["content_id"],
                "isInline": True,
            }
        )
    return out


def microsoft_send_message(
    email: str,
    to: str,
    subject: str,
    body: str,
    cc: str | None = None,
    bcc: str | None = None,
    attachments: list[MimeAsset] | None = None,
    inline_images: list[InlineImage] | None = None,
) -> bool:
    def _addr(s: str) -> list[dict[str, dict[str, str]]]:
        return [{"emailAddress": {"address": a.strip()}} for a in s.split(",") if a.strip()]

    is_html = body.strip().startswith("<")
    payload: dict[str, Any] = {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML" if is_html else "Text", "content": body},
            "toRecipients": _addr(to),
        },
        "saveToSentItems": True,
    }
    if cc:
        payload["message"]["ccRecipients"] = _addr(cc)
    if bcc:
        payload["message"]["bccRecipients"] = _addr(bcc)
    graph_atts = _graph_attachments(attachments, inline_images)
    if graph_atts:
        payload["message"]["attachments"] = graph_atts

    return bool(_authed_post(email, "/me/sendMail", payload))


def microsoft_reply_message(
    email: str,
    message_id: str,
    body: str,
    to: str | None = None,
    cc: str | None = None,
    bcc: str | None = None,
    attachments: list[MimeAsset] | None = None,
    inline_images: list[InlineImage] | None = None,
) -> bool:
    is_html = body.strip().startswith("<")
    payload: dict[str, Any] = {
        "comment": body,
        "message": {"body": {"contentType": "HTML" if is_html else "Text", "content": body}},
    }
    graph_atts = _graph_attachments(attachments, inline_images)
    if graph_atts:
        payload["message"]["attachments"] = graph_atts
    return bool(_authed_post(email, f"/me/messages/{message_id}/reply", payload))


def microsoft_mark_read(email: str, message_id: str, is_read: bool) -> bool:
    return bool(_authed_patch(email, f"/me/messages/{message_id}", {"isRead": is_read}))


def microsoft_star_message(email: str, message_id: str, starred: bool) -> bool:
    flag_status = "flagged" if starred else "notFlagged"
    return bool(
        _authed_patch(
            email,
            f"/me/messages/{message_id}",
            {"flag": {"flagStatus": flag_status}},
        )
    )


def microsoft_trash_message(email: str, message_id: str) -> bool:
    return bool(
        _authed_post(
            email,
            f"/me/messages/{message_id}/move",
            {"destinationId": "deleteditems"},
        )
    )


def microsoft_move_message(email: str, message_id: str, destination: str) -> bool:
    graph_dest = _GNOSI_TO_GRAPH.get(destination.upper(), destination.lower())
    return bool(
        _authed_post(
            email,
            f"/me/messages/{message_id}/move",
            {"destinationId": graph_dest},
        )
    )
