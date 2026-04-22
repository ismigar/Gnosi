import logging
import json
import base64
from pathlib import Path
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from backend.config.app_config import load_params

log = logging.getLogger(__name__)


def get_google_email_accounts():
    """Returns a list of registered Google email accounts from integrations.json."""
    cfg = load_params(strict_env=False)
    integrations_file = cfg.paths["SECRETS"] / "integrations.json"

    if not integrations_file.exists():
        return []

    try:
        data = json.loads(integrations_file.read_text(encoding="utf-8"))
        accounts = []
        for account in data.get("emails", []):
            if (
                account.get("provider") == "google"
                and account.get("auth_type") == "oauth2"
            ):
                acc_email = account.get("email", "")
                if acc_email:
                    accounts.append(acc_email)
        return accounts
    except Exception as e:
        log.error(f"Failed to read accounts from integrations.json: {e}")
        return []


def get_gmail_service(email: str):
    """Initializes and returns the Gmail service for a given email."""
    cfg = load_params(strict_env=False)
    integrations_file = cfg.paths["SECRETS"] / "integrations.json"

    if not integrations_file.exists():
        log.error("No integrations.json found to sync Gmail.")
        return None

    try:
        data = json.loads(integrations_file.read_text(encoding="utf-8"))
    except Exception as e:
        log.error(f"Failed to read integrations.json: {e}")
        return None

    from backend.config.env_config import get_env

    for account in data.get("emails", []):
        if account.get("provider") == "google" and account.get("auth_type") == "oauth2":
            acc_email = account.get("email", "")
            if acc_email == email:
                try:
                    # Resolve client credentials with environment fallback
                    client_id = account.get("client_id") or get_env("GOOGLE_OAUTH_CLIENT_ID")
                    client_secret = account.get("client_secret") or get_env("GOOGLE_OAUTH_CLIENT_SECRET")
                    
                    if not client_id or not client_secret:
                        log.error(f"❌ Missing OAuth client credentials for {email}. Sync will fail.")
                        continue

                    creds_dict = {
                        "token": account.get("token"),
                        "refresh_token": account.get("refresh_token"),
                        "token_uri": account.get(
                            "token_uri", "https://oauth2.googleapis.com/token"
                        ),
                        "client_id": client_id,
                        "client_secret": client_secret,
                    }
                    creds = Credentials(**creds_dict)
                    return build("gmail", "v1", credentials=creds)
                except Exception as e:
                    log.error(f"Error initializing Gmail service for {email}: {e}")
                    return None
    return None


def list_threads(email: str, query: str = "label:INBOX", max_results: int = 50):
    """Lists threads for a given user and query."""
    service = get_gmail_service(email)
    if not service:
        return []

    try:
        results = (
            service.users()
            .threads()
            .list(userId="me", q=query, maxResults=max_results)
            .execute()
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
            date = next(
                (h["value"] for h in headers if h["name"].lower() == "date"), ""
            )

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


def get_thread_details(email: str, thread_id: str):
    """Fetches full details for a thread."""
    service = get_gmail_service(email)
    if not service:
        return None

    try:
        thread = service.users().threads().get(userId="me", id=thread_id).execute()
        return thread
    except Exception as e:
        log.error(f"Error getting thread details for {thread_id} for {email}: {e}")
        return None


def send_reply(
    email: str,
    thread_id: str,
    body: str,
    to_recipients: str = None,
    cc_recipients: str = None,
    bcc_recipients: str = None,
    subject: str = None,
    attachments: list = None,
):
    """Sends a reply or forward to an existing thread, with optional attachments."""
    service = get_gmail_service(email)
    if not service:
        return False

    try:
        thread = service.users().threads().get(userId="me", id=thread_id).execute()
        last_msg = thread["messages"][-1]
        headers = last_msg["payload"]["headers"]
        orig_subject = next(
            (h["value"] for h in headers if h["name"].lower() == "subject"), ""
        )

        if attachments:
            msg = MIMEMultipart("mixed")
        else:
            content_type = "html" if body.strip().startswith("<") else "plain"
            msg = MIMEMultipart("mixed")
            msg.attach(MIMEText(body, content_type))

        msg["In-Reply-To"] = last_msg["id"]
        msg["References"] = last_msg["id"]

        if to_recipients:
            msg["To"] = to_recipients
        else:
            original_to = next(
                (h["value"] for h in headers if h["name"].lower() == "to"), email
            )
            original_from = next(
                (h["value"] for h in headers if h["name"].lower() == "from"), ""
            )
            msg["To"] = original_from if original_from != email else original_to

        if cc_recipients:
            msg["Cc"] = cc_recipients

        if bcc_recipients:
            msg["Bcc"] = bcc_recipients

        msg["Subject"] = subject if subject else (
            f"Re: {orig_subject}"
            if not orig_subject.lower().startswith("re:")
            else orig_subject
        )

        if attachments:
            content_type = "html" if body.strip().startswith("<") else "plain"
            msg.attach(MIMEText(body, content_type))
            for att in attachments:
                part = MIMEBase("application", "octet-stream")
                part.set_payload(att["data"])
                encoders.encode_base64(part)
                filename = att.get("filename", "attachment")
                part.add_header("Content-Disposition", f'attachment; filename="{filename}"')
                part.add_header("Content-Type", att.get("content_type", "application/octet-stream"))
                msg.attach(part)

        raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        service.users().messages().send(
            userId="me", body={"raw": raw_message, "threadId": thread_id}
        ).execute()

        return True
    except Exception as e:
        log.error(f"Error sending reply/forward to thread {thread_id}: {e}")
        return False


def update_labels(email: str, gmail_id: str, add_labels: list = None, remove_labels: list = None):
    """Updates labels for a thread or message (tries thread first, falls back to message)."""
    service = get_gmail_service(email)
    if not service:
        return False
    body = {}
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
    email: str, thread_id: str, add_labels: list = None, remove_labels: list = None
):
    return update_labels(email, thread_id, add_labels, remove_labels)


def trash_gmail(email: str, gmail_id: str):
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


def trash_thread(email: str, thread_id: str):
    return trash_gmail(email, thread_id)


def untrash_thread(email: str, thread_id: str):
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


def send_new_message(email: str, to: str, subject: str, body: str, cc: str = None, bcc: str = None):
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
    cc: str = None,
    bcc: str = None,
    attachments: list = None,
):
    """Sends a new email with optional file attachments."""
    service = get_gmail_service(email)
    if not service:
        return False
    try:
        msg = MIMEMultipart("mixed")
        msg["To"] = to
        msg["From"] = email
        msg["Subject"] = subject
        if cc:
            msg["Cc"] = cc
        if bcc:
            msg["Bcc"] = bcc

        content_type = "html" if body.strip().startswith("<") else "plain"
        msg.attach(MIMEText(body, content_type))

        for att in (attachments or []):
            part = MIMEBase("application", "octet-stream")
            part.set_payload(att["data"])
            encoders.encode_base64(part)
            filename = att.get("filename", "attachment")
            part.add_header("Content-Disposition", f'attachment; filename="{filename}"')
            part.add_header("Content-Type", att.get("content_type", "application/octet-stream"))
            msg.attach(part)

        raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        service.users().messages().send(userId="me", body={"raw": raw_message}).execute()
        return True
    except Exception as e:
        log.error(f"Error sending message with attachments from {email}: {e}")
        return False
