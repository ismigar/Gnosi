import logging
import base64
import yaml
from pathlib import Path
from typing import Any
from backend.services.google_mail_service import get_gmail_service
from backend.config.app_config import load_params
from backend.utils.safe_io import safe_write_text

log = logging.getLogger(__name__)

# Labels indicating the folder type in Gmail
_LABEL_TYPE_MAP = {
    'SENT': 'Sent',
    'DRAFT': 'Draft',
    'SPAM': 'Spam',
    'TRASH': 'Deleted',
}

# Queries by folder + resulting type
_FOLDER_QUERIES = [
    ('label:INBOX', 'Received'),
    ('label:SENT',  'Sent'),
    ('in:drafts',   'Draft'),
    ('label:SPAM',  'Spam'),
    ('label:TRASH', 'Deleted'),
]

# Gmail category labels → nom intern
_CATEGORY_LABEL_MAP = {
    'CATEGORY_PROMOTIONS': 'Promotions',
    'CATEGORY_SOCIAL':     'Social',
    'CATEGORY_UPDATES':    'Updates',
    'CATEGORY_FORUMS':     'Forums',
    'CATEGORY_PERSONAL':   'Personal',
}


class VaultMailSyncService:
    def __init__(self) -> None:
        self.config = load_params()
        raw_vault = self.config.paths.get("VAULT")
        self.vault_path = Path(raw_vault) if raw_vault else None
        self.mail_folder = self.vault_path / "Mail" if self.vault_path else None
        if self.mail_folder:
            try:
                self.mail_folder.mkdir(parents=True, exist_ok=True)
            except Exception:
                pass

    def sync_emails(self, email_account: str, limit: int = 20) -> int:
        """Syncs recent emails from Gmail (INBOX, SENT, DRAFTS, SPAM) to the Vault."""
        from backend.services.integration_manager import integration_manager
        integrations = integration_manager.get_all_safe()

        account_data = next(
            (acc for acc in (integrations.get("emails", []) + integrations.get("mail_accounts", []))
             if acc.get("email") == email_account),
            None
        )
        if account_data and account_data.get("provider") != "google":
            log.info(f"Skipping sync for non-Google account: {email_account} (IMAP support pending)")
            return 0

        service = get_gmail_service(email_account)
        if not service:
            log.debug(f"Could not initialize Gmail service for {email_account}")
            return 0

        total_synced = 0
        for query, default_type in _FOLDER_QUERIES:
            try:
                results = service.users().messages().list(
                    userId='me', maxResults=limit, q=query
                ).execute()
                for msg_meta in results.get('messages', []):
                    if self._sync_single_message(service, msg_meta['id'], email_account, default_type):
                        total_synced += 1
            except Exception as e:
                log.error(f"Error syncing folder '{query}' for {email_account}: {e}")

        return total_synced

    def _sync_single_message(
        self,
        service: Any,
        msg_id: str,
        email_account: str,
        default_type: str,
    ) -> bool:
        """Syncs a single Gmail message to .md (+ optional .html) files in the Vault."""
        try:
            # Fast duplicate check by msg_id prefix in filename
            mail_folder = self.mail_folder
            if mail_folder is None:
                raise RuntimeError("Vault Mail folder is not configured")
            existing = list(mail_folder.glob(f"{msg_id}_*.md"))
            if existing:
                return False

            msg = service.users().messages().get(userId='me', id=msg_id, format='full').execute()
            label_ids = msg.get('labelIds', [])
            payload = msg.get('payload', {})
            headers = payload.get('headers', [])

            def _header(name: str) -> str:
                return next(
                    (
                        str(header.get("value") or "")
                        for header in headers
                        if str(header.get("name") or "").lower() == name.lower()
                    ),
                    "",
                )

            subject = _header('Subject') or "Untitled"
            sender  = _header('From')    or "Unknown"
            to      = _header('To')      or ""
            cc      = _header('Cc')      or ""
            bcc     = _header('Bcc')     or ""
            date_str = _header('Date')   or ""
            thread_id = msg.get('threadId', msg_id)

            # Detect type from Gmail labels
            msg_type = default_type
            for label, label_type in _LABEL_TYPE_MAP.items():
                if label in label_ids:
                    msg_type = label_type
                    break

            is_read = 'UNREAD' not in label_ids
            has_attachments = self._has_attachments(payload)

            # Extract bodies
            text_body = self._extract_text(payload)
            html_body = self._extract_html(payload)

            # Build filename
            clean = "".join(c for c in subject if c.isalnum() or c in (' ', '-', '_')).strip()[:50]
            filename = f"{msg_id}_{clean}.md"
            file_path = mail_folder / filename

            def _sanitize(val: str) -> str:
                return val.replace('"', '\\"') if isinstance(val, str) else val

            metadata = {
                "title":            _sanitize(subject),
                "id":               msg_id,
                "gmail_id":         msg_id,
                "thread_id":        thread_id,
                "type":             msg_type,
                "sender":           _sanitize(sender),
                "recipients":       _sanitize(to),
                "cc":               _sanitize(cc),
                "bcc":              _sanitize(bcc),
                "date":             date_str,
                "is_read":          is_read,
                "is_starred":       'STARRED' in label_ids,
                "has_attachments":  has_attachments,
                "has_html":         bool(html_body),
                "category":         next((v for k, v in _CATEGORY_LABEL_MAP.items() if k in label_ids), 'Main'),
                "archived":         'TRASH' in label_ids,
                "spam":             'SPAM' in label_ids,
                "account":          email_account,
                "database_table_id": "mail",
            }

            yaml_front = yaml.dump(metadata, default_flow_style=False, sort_keys=False, allow_unicode=True)
            safe_write_text(file_path, f"---\n{yaml_front}---\n\n{text_body}\n")

            if html_body:
                html_path = file_path.with_suffix('.html')
                safe_write_text(html_path, html_body)

            log.info(f"Synced email to Vault: {filename}")
            return True

        except Exception as e:
            log.error(f"Error syncing message {msg_id}: {e}")
            return False

    # ------------------------------------------------------------------ #
    # Helpers                                                              #
    # ------------------------------------------------------------------ #

    def _extract_text(self, payload: dict[str, Any]) -> str:
        """Recursively extracts text/plain body."""
        if 'parts' in payload:
            for part in payload['parts']:
                result = self._extract_text(part)
                if result:
                    return result
        if payload.get('mimeType') == 'text/plain':
            data = payload.get('body', {}).get('data', '')
            if data:
                return base64.urlsafe_b64decode(data).decode('utf-8', errors='replace')
        return ""

    def _extract_html(self, payload: dict[str, Any]) -> str:
        """Recursively extracts text/html body."""
        if 'parts' in payload:
            for part in payload['parts']:
                result = self._extract_html(part)
                if result:
                    return result
        if payload.get('mimeType') == 'text/html':
            data = payload.get('body', {}).get('data', '')
            if data:
                return base64.urlsafe_b64decode(data).decode('utf-8', errors='replace')
        return ""

    def _has_attachments(self, payload: dict[str, Any]) -> bool:
        """Returns True if the message has any non-text attachments."""
        mime = payload.get('mimeType', '')
        if mime not in ('text/plain', 'text/html', '') and payload.get('body', {}).get('attachmentId'):
            return True
        for part in payload.get('parts', []):
            if self._has_attachments(part):
                return True
        return False


sync_service = VaultMailSyncService()
