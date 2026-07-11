"""Microsoft Graph API mail service.

Provides the same interface as google_mail_service / hybrid_mail_service
so the dispatch layer (mail_routes, hybrid_mail_service) can treat it
uniformly.

Token refresh is handled transparently: if the access token is expired
the refresh_token is used and the new token is persisted via
integration_manager.update_mail_account_token().
"""
import logging
import requests as http
from datetime import datetime, timezone
from typing import Optional

log = logging.getLogger(__name__)

GRAPH = "https://graph.microsoft.com/v1.0"
TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"

# Graph folder id → logical key used throughout Gnosi
_WELL_KNOWN_FOLDERS = {
    "inbox":        "INBOX",
    "sentitems":    "SENT",
    "drafts":       "DRAFTS",
    "deleteditems": "TRASH",
    "junkemail":    "SPAM",
    "archive":      "ARCHIVE",
}
_GNOSI_TO_GRAPH = {v: k for k, v in _WELL_KNOWN_FOLDERS.items()}
_GNOSI_TO_GRAPH["all"] = "inbox"  # fallback

_MSG_SELECT = ",".join([
    "id", "subject", "from", "toRecipients", "ccRecipients",
    "receivedDateTime", "sentDateTime", "isRead", "flag",
    "hasAttachments", "bodyPreview", "parentFolderId",
    "isDraft", "isDeleted",
])


# ── Token management ───────────────────────────────────────────────────────────

def _refresh_token(account: dict) -> Optional[str]:
    """Refreshes the access token using the refresh_token.  Returns new token or None."""
    from backend.services.integration_manager import integration_manager
    try:
        resp = http.post(TOKEN_URL, data={
            "client_id":     account.get("client_id"),
            "client_secret": account.get("client_secret"),
            "refresh_token": account.get("refresh_token"),
            "grant_type":    "refresh_token",
            "scope":         "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access User.Read",
        }, timeout=15)
        resp.raise_for_status()
        new_token = resp.json().get("access_token")
        if new_token:
            email = account.get("email", "")
            integration_manager.update_mail_account_token(email, new_token)
            log.info(f"[Microsoft] Token renovat per {email}")
        return new_token
    except Exception as e:
        log.error(f"[Microsoft] Error refrescant token: {e}")
        return None


def _get_token(email: str) -> Optional[str]:
    """Returns a valid access token, refreshing if necessary."""
    from backend.services.integration_manager import integration_manager
    account = integration_manager.get_mail_account(email)
    if not account:
        return None
    token = account.get("token")
    if not token:
        return _refresh_token(account)
    return token


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _graph(method: str, path: str, token: str, **kwargs):
    """Wrapper around requests that retries once after a 401 with a refreshed token."""
    resp = getattr(http, method)(f"{GRAPH}{path}", headers=_headers(token), **kwargs)
    return resp


def _authed_get(email: str, path: str, **kwargs):
    """GET with automatic token refresh on 401."""
    from backend.services.integration_manager import integration_manager
    account = integration_manager.get_mail_account(email)
    if not account:
        return None
    token = account.get("token")
    resp = _graph("get", path, token, **kwargs)
    if resp.status_code == 401 and account.get("refresh_token"):
        token = _refresh_token(account)
        if token:
            resp = _graph("get", path, token, **kwargs)
    if not resp.ok:
        log.error(f"[Microsoft] GET {path} → {resp.status_code}: {resp.text[:200]}")
        return None
    return resp.json()


def _authed_post(email: str, path: str, json_body: dict, **kwargs):
    """POST with automatic token refresh on 401."""
    from backend.services.integration_manager import integration_manager
    account = integration_manager.get_mail_account(email)
    if not account:
        return False
    token = account.get("token")
    resp = _graph("post", path, token, json=json_body, **kwargs)
    if resp.status_code == 401 and account.get("refresh_token"):
        token = _refresh_token(account)
        if token:
            resp = _graph("post", path, token, json=json_body, **kwargs)
    if not resp.ok:
        log.error(f"[Microsoft] POST {path} → {resp.status_code}: {resp.text[:200]}")
        return False
    return True


def _authed_patch(email: str, path: str, json_body: dict):
    """PATCH with automatic token refresh on 401."""
    from backend.services.integration_manager import integration_manager
    account = integration_manager.get_mail_account(email)
    if not account:
        return False
    token = account.get("token")
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


def _parse_message(msg: dict, account_email: str) -> dict:
    sender_obj = msg.get("from", {}).get("emailAddress", {})
    sender = f"{sender_obj.get('name', '')} <{sender_obj.get('address', '')}>".strip()

    def _addrs(field):
        return ", ".join(
            f"{r['emailAddress'].get('name','')} <{r['emailAddress'].get('address','')}>".strip()
            for r in msg.get(field, [])
        )

    flag_status = msg.get("flag", {}).get("flagStatus", "notFlagged")
    date_str = msg.get("receivedDateTime") or msg.get("sentDateTime", "")

    # Determine type from parentFolderId display name or isDraft
    msg_type = "Received"
    if msg.get("isDraft"):
        msg_type = "Draft"

    return {
        "id":              msg["id"],
        "thread_id":       msg.get("conversationId", msg["id"]),
        "subject":         msg.get("subject") or "(sense assumpte)",
        "sender":          sender,
        "recipient":       _addrs("toRecipients"),
        "cc":              _addrs("ccRecipients"),
        "date":            date_str,
        "timestamp":       _ts(date_str),
        "snippet":         msg.get("bodyPreview", ""),
        "is_read":         msg.get("isRead", True),
        "is_starred":      flag_status == "flagged",
        "has_attachments": msg.get("hasAttachments", False),
        "category":        "Main",
        "type":            msg_type,
        "account":         account_email,
        "source":          "microsoft",
        "archived":        False,
        "_folder_id":      msg.get("parentFolderId", ""),
    }


# ── Public API ─────────────────────────────────────────────────────────────────

def microsoft_list_messages(
    email: str,
    folder: str = "INBOX",
    category: str = None,
    search: str = None,
    limit: int = 50,
    page_token: str = None,
) -> dict:
    graph_folder = _GNOSI_TO_GRAPH.get(folder.upper() if folder else "INBOX", "inbox")

    params: dict = {
        "$top":     min(limit, 100),
        "$select":  _MSG_SELECT,
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
        msg = f"No s'ha pogut connectar amb Microsoft 365 per a {email}. Comprova les credencials."
        return {"messages": [], "next_page_token": None, "total": 0, "error": msg}

    messages = [_parse_message(m, email) for m in data.get("value", [])]

    # Extract skip token from @odata.nextLink
    next_link = data.get("@odata.nextLink", "")
    next_token = None
    if next_link and "$skiptoken=" in next_link:
        next_token = next_link.split("$skiptoken=")[-1].split("&")[0]

    return {
        "messages":        messages,
        "next_page_token": next_token,
        "total":           len(messages),
    }


def microsoft_get_message(email: str, message_id: str) -> Optional[dict]:
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


def microsoft_get_inline_parts(email: str, message_id: str, wanted_cids: set) -> dict:
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
    parts = {}
    for att in data.get("value", []):
        cid = (att.get("contentId") or "").strip("<>")
        content_bytes = att.get("contentBytes")
        if not cid or cid not in wanted or cid in parts or not content_bytes:
            continue
        try:
            raw = base64.b64decode(content_bytes)
        except Exception:
            log.warning(f"[Microsoft] contentBytes invàlid per al cid {cid} de {message_id}")
            continue
        if raw:
            parts[cid] = {
                "filename": att.get("name") or "image",
                "content_type": att.get("contentType") or "application/octet-stream",
                "data": raw,
            }
    return parts


def microsoft_get_counts(email: str) -> dict:
    data = _authed_get(email, "/me/mailFolders", params={"$top": 20})
    if not data:
        return {}
    counts = {}
    for folder in data.get("value", []):
        key = _WELL_KNOWN_FOLDERS.get(folder.get("wellKnownName", "").lower())
        if key:
            counts[key] = {
                "total":  folder.get("totalItemCount", 0),
                "unread": folder.get("unreadItemCount", 0),
            }
    counts["all"] = counts.get("INBOX", {"total": 0, "unread": 0})
    counts["NOT_ARCHIVED"] = counts.get("INBOX", {"total": 0, "unread": 0})
    return counts


def _graph_attachments(attachments: list = None, inline_images: list = None) -> list:
    """Maps attachments {filename, content_type, data} and inline images
    {…, content_id} to Microsoft Graph's fileAttachment format."""
    import base64

    out = []
    for att in (attachments or []):
        out.append({
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name": att.get("filename") or "attachment",
            "contentType": att.get("content_type") or "application/octet-stream",
            "contentBytes": base64.b64encode(att["data"]).decode(),
        })
    for img in (inline_images or []):
        out.append({
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name": img.get("filename") or "image",
            "contentType": img.get("content_type") or "application/octet-stream",
            "contentBytes": base64.b64encode(img["data"]).decode(),
            "contentId": img["content_id"],
            "isInline": True,
        })
    return out


def microsoft_send_message(
    email: str, to: str, subject: str, body: str,
    cc: str = None, bcc: str = None,
    attachments: list = None, inline_images: list = None,
) -> bool:
    def _addr(s):
        return [{"emailAddress": {"address": a.strip()}} for a in s.split(",") if a.strip()]

    is_html = body.strip().startswith("<")
    payload = {
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

    return _authed_post(email, "/me/sendMail", payload)


def microsoft_reply_message(
    email: str, message_id: str, body: str,
    to: str = None, cc: str = None, bcc: str = None,
    attachments: list = None, inline_images: list = None,
) -> bool:
    is_html = body.strip().startswith("<")
    payload = {"comment": body, "message": {"body": {"contentType": "HTML" if is_html else "Text", "content": body}}}
    graph_atts = _graph_attachments(attachments, inline_images)
    if graph_atts:
        payload["message"]["attachments"] = graph_atts
    return _authed_post(email, f"/me/messages/{message_id}/reply", payload)


def microsoft_mark_read(email: str, message_id: str, is_read: bool) -> bool:
    return _authed_patch(email, f"/me/messages/{message_id}", {"isRead": is_read})


def microsoft_star_message(email: str, message_id: str, starred: bool) -> bool:
    flag_status = "flagged" if starred else "notFlagged"
    return _authed_patch(email, f"/me/messages/{message_id}", {"flag": {"flagStatus": flag_status}})


def microsoft_trash_message(email: str, message_id: str) -> bool:
    return _authed_post(email, f"/me/messages/{message_id}/move", {"destinationId": "deleteditems"})


def microsoft_move_message(email: str, message_id: str, destination: str) -> bool:
    graph_dest = _GNOSI_TO_GRAPH.get(destination.upper(), destination.lower())
    return _authed_post(email, f"/me/messages/{message_id}/move", {"destinationId": graph_dest})
