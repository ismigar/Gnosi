import logging
import json
import base64
from pathlib import Path
from email.mime.text import MIMEText
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

    for account in data.get("emails", []):
        if account.get("provider") == "google" and account.get("auth_type") == "oauth2":
            acc_email = account.get("email", "")
            if acc_email == email:
                try:
                    creds_dict = {
                        "token": account.get("token"),
                        "refresh_token": account.get("refresh_token"),
                        "token_uri": account.get(
                            "token_uri", "https://oauth2.googleapis.com/token"
                        ),
                        "client_id": account.get("client_id"),
                        "client_secret": account.get("client_secret"),
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
    subject: str = None,
):
    """Sends a reply or forward to an existing thread."""
    service = get_gmail_service(email)
    if not service:
        return False

    try:
        # Get the latest message ID and references for proper threading
        thread = service.users().threads().get(userId="me", id=thread_id).execute()
        last_msg = thread["messages"][-1]

        # Build the message
        message = MIMEText(body)

        # Headers for threading
        message["In-Reply-To"] = last_msg["id"]
        message["References"] = last_msg["id"]

        # Find original headers
        headers = last_msg["payload"]["headers"]
        orig_subject = next(
            (h["value"] for h in headers if h["name"].lower() == "subject"), ""
        )

        if to_recipients:
            message["To"] = to_recipients
        else:
            # Automatic reply logic
            original_to = next(
                (h["value"] for h in headers if h["name"].lower() == "to"), email
            )
            original_from = next(
                (h["value"] for h in headers if h["name"].lower() == "from"), ""
            )
            message["To"] = original_from if original_from != email else original_to

        if cc_recipients:
            message["Cc"] = cc_recipients

        if subject:
            message["Subject"] = subject
        else:
            message["Subject"] = (
                f"Re: {orig_subject}"
                if not orig_subject.lower().startswith("re:")
                else orig_subject
            )

        raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode()

        service.users().messages().send(
            userId="me", body={"raw": raw_message, "threadId": thread_id}
        ).execute()

        return True
    except Exception as e:
        log.error(f"Error sending reply/forward to thread {thread_id}: {e}")
        return False


def update_thread_labels(
    email: str, thread_id: str, add_labels: list = None, remove_labels: list = None
):
    """Updates labels for a thread."""
    service = get_gmail_service(email)
    if not service:
        return False

    body = {}
    if add_labels:
        body["addLabelIds"] = add_labels
    if remove_labels:
        body["removeLabelIds"] = remove_labels

    try:
        service.users().threads().modify(userId="me", id=thread_id, body=body).execute()
        return True
    except Exception as e:
        log.error(f"Error updating labels for thread {thread_id}: {e}")
        return False
