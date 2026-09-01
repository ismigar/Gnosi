from __future__ import annotations

from typing import Any

import logging
import base64
from email.mime.text import MIMEText
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build  # type: ignore[import-untyped]

from backend.services.mail_inline_images import InlineImage, MimeAsset, build_mail_content

log = logging.getLogger(__name__)


def get_google_email_accounts() -> list[str]:
    """Returns email addresses of all registered Google OAuth2 accounts."""
    from backend.services.integration_manager import integration_manager

    return [
        acc.get("email", "")
        for acc in integration_manager.get_all_mail_accounts()
        if integration_manager.is_google_account(acc) and acc.get("email")
    ]


def get_gmail_service(email: str) -> Any | None:
    """Builds and returns an authenticated Gmail API service for *email*.

    Automatically refreshes an expired access token and persists the new one.
    Returns None if the account is not found, not Google OAuth2, or auth fails.
    """
    from backend.services.integration_manager import integration_manager
    from backend.config.env_config import get_env

    account = integration_manager.get_mail_account(email)
    if not account or not integration_manager.is_google_account(account):
        log.warning(f"[Gmail] No OAuth2 Google account found for {email}")
        return None

    client_id = account.get("client_id") or get_env("GOOGLE_OAUTH_CLIENT_ID")
    client_secret = account.get("client_secret") or get_env("GOOGLE_OAUTH_CLIENT_SECRET")
    if not client_id or not client_secret:
        log.error(f"[Gmail] Missing OAuth client credentials for {email}")
        return None

    try:
        creds = Credentials(  # type: ignore[no-untyped-call]
            token=account.get("token"),
            refresh_token=account.get("refresh_token"),
            token_uri=account.get("token_uri", "https://oauth2.googleapis.com/token"),
            client_id=client_id,
            client_secret=client_secret,
        )
        if creds.expired and creds.refresh_token:
            from google.auth.transport.requests import Request

            creds.refresh(Request())  # type: ignore[no-untyped-call]
            if isinstance(creds.token, str):
                integration_manager.update_mail_account_token(email, creds.token)
            log.info(f"[Gmail] Token renewed for {email}")
        return build("gmail", "v1", credentials=creds)
    except Exception as e:
        log.error(f"[Gmail] Failed to initialize service for {email}: {e}")
        return None


def list_threads(
    email: str, query: str = "label:INBOX", max_results: int = 50
) -> list[dict[str, Any]]:
    """Lists threads for a given user and query."""
    service = get_gmail_service(email)
    if not service:
        return []

    try:
        results = (
            service.users().threads().list(userId="me", q=query, maxResults=max_results).execute()
        )
        threads = results.get("threads", [])

        detailed_threads = []
        for thread in threads:
            t = (
                service.users()
                .threads()
                .get(userId="me", id=thread["id"], format="minimal")
                .execute()
            )
            # Extract snippet and last message info from 't'
            messages = t.get("messages", [])
            if not messages:
                continue

            last_msg = messages[-1]
            payload = last_msg.get("payload", {})
            headers = payload.get("headers", [])

            subject = next(
                (h["value"] for h in headers if h["name"].lower() == "subject"),
                "Untitled",
            )
            sender = next(
                (h["value"] for h in headers if h["name"].lower() == "from"),
                "Unknown",
            )
            date = next((h["value"] for h in headers if h["name"].lower() == "date"), "")

            detailed_threads.append(
                {
                    "id": thread["id"],
                    "subject": subject,
                    "from": sender,
                    "date": date,
                    "snippet": t.get("snippet", ""),
                    "historyId": t.get("historyId"),
                    "message_count": len(messages),
                }
            )

        return detailed_threads
    except Exception as e:
        log.error(f"Error listing threads for {email}: {e}")
        return []


def get_thread_details(email: str, thread_id: str) -> dict[str, Any] | None:
    """Fetches full details for a thread."""
    service = get_gmail_service(email)
    if not service:
        return None

    try:
        thread = service.users().threads().get(userId="me", id=thread_id).execute()
        return thread if isinstance(thread, dict) else None
    except Exception as e:
        log.error(f"Error getting thread details for {thread_id} for {email}: {e}")
        return None


def send_reply(
    email: str,
    thread_id: str,
    body: str,
    to_recipients: str | None = None,
    cc_recipients: str | None = None,
    bcc_recipients: str | None = None,
    subject: str | None = None,
    attachments: list[MimeAsset] | None = None,
    inline_images: list[InlineImage] | None = None,
) -> bool:
    """Sends a reply or forward to an existing thread, with optional attachments."""
    service = get_gmail_service(email)
    if not service:
        return False

    try:
        thread = service.users().threads().get(userId="me", id=thread_id).execute()
        last_msg = thread["messages"][-1]
        headers = last_msg["payload"]["headers"]
        orig_subject = next((h["value"] for h in headers if h["name"].lower() == "subject"), "")

        msg = build_mail_content(body, attachments=attachments, inline_images=inline_images)

        msg["In-Reply-To"] = last_msg["id"]
        msg["References"] = last_msg["id"]

        if to_recipients:
            msg["To"] = to_recipients
        else:
            original_to = next((h["value"] for h in headers if h["name"].lower() == "to"), email)
            original_from = next((h["value"] for h in headers if h["name"].lower() == "from"), "")
            msg["To"] = original_from if original_from != email else original_to

        if cc_recipients:
            msg["Cc"] = cc_recipients

        if bcc_recipients:
            msg["Bcc"] = bcc_recipients

        msg["Subject"] = (
            subject
            if subject
            else (
                f"Re: {orig_subject}"
                if not orig_subject.lower().startswith("re:")
                else orig_subject
            )
        )

        raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        service.users().messages().send(
            userId="me", body={"raw": raw_message, "threadId": thread_id}
        ).execute()

        return True
    except Exception as e:
        log.error(f"Error sending reply/forward to thread {thread_id}: {e}")
        return False


def update_labels(
    email: str,
    gmail_id: str,
    add_labels: list[str] | None = None,
    remove_labels: list[str] | None = None,
) -> bool:
    """Updates labels for a thread or message (tries thread first, falls back to message)."""
    service = get_gmail_service(email)
    if not service:
        return False
    body: dict[str, list[str]] = {}
    if add_labels:
        body["addLabelIds"] = add_labels
    if remove_labels:
        body["removeLabelIds"] = remove_labels
    try:
        service.users().threads().modify(userId="me", id=gmail_id, body=body).execute()
        return True
    except Exception:
        pass
    try:
        service.users().messages().modify(userId="me", id=gmail_id, body=body).execute()
        return True
    except Exception as e:
        log.error(f"Error updating labels for {gmail_id}: {e}")
        return False


def update_thread_labels(
    email: str,
    thread_id: str,
    add_labels: list[str] | None = None,
    remove_labels: list[str] | None = None,
) -> bool:
    return update_labels(email, thread_id, add_labels, remove_labels)


def trash_gmail(email: str, gmail_id: str) -> bool:
    """Moves a thread or message to trash."""
    service = get_gmail_service(email)
    if not service:
        return False
    try:
        service.users().threads().trash(userId="me", id=gmail_id).execute()
        return True
    except Exception:
        pass
    try:
        service.users().messages().trash(userId="me", id=gmail_id).execute()
        return True
    except Exception as e:
        log.error(f"Error trashing {gmail_id}: {e}")
        return False


def trash_thread(email: str, thread_id: str) -> bool:
    return trash_gmail(email, thread_id)


def untrash_thread(email: str, thread_id: str) -> bool:
    """Untrashes a thread."""
    service = get_gmail_service(email)
    if not service:
        return False
    try:
        service.users().threads().untrash(userId="me", id=thread_id).execute()
        return True
    except Exception as e:
        log.error(f"Error untrashing thread {thread_id}: {e}")
        return False


def send_new_message(
    email: str,
    to: str,
    subject: str,
    body: str,
    cc: str | None = None,
    bcc: str | None = None,
) -> bool:
    """Sends a brand new email message."""
    service = get_gmail_service(email)
    if not service:
        return False
    try:
        message = MIMEText(body, "html" if body.strip().startswith("<") else "plain")
        message["To"] = to
        message["From"] = email
        message["Subject"] = subject
        if cc:
            message["Cc"] = cc
        if bcc:
            message["Bcc"] = bcc

        raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
        service.users().messages().send(userId="me", body={"raw": raw_message}).execute()
        return True
    except Exception as e:
        log.error(f"Error sending new message from {email}: {e}")
        return False


def send_new_message_with_attachments(
    email: str,
    to: str,
    subject: str,
    body: str,
    cc: str | None = None,
    bcc: str | None = None,
    attachments: list[MimeAsset] | None = None,
    inline_images: list[InlineImage] | None = None,
) -> bool:
    """Sends a new email with optional file attachments and inline images."""
    service = get_gmail_service(email)
    if not service:
        return False
    try:
        msg = build_mail_content(body, attachments=attachments, inline_images=inline_images)
        msg["To"] = to
        msg["From"] = email
        msg["Subject"] = subject
        if cc:
            msg["Cc"] = cc
        if bcc:
            msg["Bcc"] = bcc

        raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        service.users().messages().send(userId="me", body={"raw": raw_message}).execute()
        return True
    except Exception as e:
        log.error(f"Error sending message with attachments from {email}: {e}")
        return False


def save_gmail_draft(
    email: str,
    to: str,
    subject: str,
    body: str,
    cc: str = "",
    bcc: str = "",
    gmail_draft_id: str | None = None,
) -> str | None:
    """Creates or updates a Gmail draft. Returns the Gmail draft ID on success, None on failure."""
    service = get_gmail_service(email)
    if not service:
        return None
    try:
        content_type = "html" if body.strip().startswith("<") else "plain"
        msg = MIMEText(body, content_type, "utf-8")
        msg["to"] = to or ""
        msg["from"] = email
        msg["subject"] = subject or ""
        if cc:
            msg["cc"] = cc
        if bcc:
            msg["bcc"] = bcc
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        draft_body = {"message": {"raw": raw}}
        if gmail_draft_id:
            result = (
                service.users()
                .drafts()
                .update(userId="me", id=gmail_draft_id, body=draft_body)
                .execute()
            )
        else:
            result = service.users().drafts().create(userId="me", body=draft_body).execute()
        draft_id = result.get("id")
        return draft_id if isinstance(draft_id, str) else None
    except Exception as e:
        log.error(f"Error saving Gmail draft for {email}: {e}")
        return None
