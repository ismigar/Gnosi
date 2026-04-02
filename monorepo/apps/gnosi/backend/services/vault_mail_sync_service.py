import logging
import base64
import os
from pathlib import Path
from datetime import datetime
from backend.services.google_mail_service import get_gmail_service
from backend.config.app_config import load_params

log = logging.getLogger(__name__)

class VaultMailSyncService:
    def __init__(self):
        self.config = load_params()
        raw_vault = self.config.paths.get("VAULT")
        self.vault_path = Path(raw_vault) if raw_vault else None
        self.mail_folder = self.vault_path / "Mail" if self.vault_path else None
        
        if self.mail_folder:
            try:
                self.mail_folder.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                print(f"⚠️ MailSync: Error creating Mail directory: {e}")

    def sync_emails(self, email_account: str, limit: int = 20):
        """Syncs recent emails from Gmail to the Vault."""
        service = get_gmail_service(email_account)
        if not service:
            log.error(f"Could not initialize Gmail service for {email_account}")
            return 0

        try:
            results = service.users().messages().list(userId='me', maxResults=limit, q="label:INBOX").execute()
            messages = results.get('messages', [])
            
            synced_count = 0
            for msg_meta in messages:
                if self._sync_single_message(service, msg_meta['id']):
                    synced_count += 1
            
            return synced_count
        except Exception as e:
            log.error(f"Error during vault mail sync: {e}")
            return 0

    def _sync_single_message(self, service, msg_id):
        """Syncs a single Gmail message to a .md file in the Vault."""
        try:
            # Check if already exists (fast check by ID in filename might be enough, but let's be more robust later)
            # For now, we fetch details first
            msg = service.users().messages().get(userId='me', id=msg_id, format='full').execute()
            
            thread_id = msg.get('threadId')
            headers = msg.get('payload', {}).get('headers', [])
            
            subject = next((h['value'] for h in headers if h['name'].lower() == 'subject'), "Untitled")
            sender = next((h['value'] for h in headers if h['name'].lower() == 'from'), "Unknown")
            to = next((h['value'] for h in headers if h['name'].lower() == 'to'), "")
            date_str = next((h['value'] for h in headers if h['name'].lower() == 'date'), "")
            
            # Clean subject for filename
            clean_subject = "".join([c for c in subject if c.isalnum() or c in (' ', '-', '_')]).strip()[:50]
            filename = f"{msg_id}_{clean_subject}.md"
            file_path = self.mail_folder / filename

            if file_path.exists():
                return False # Already synced

            # Extract body
            body = self._extract_body(msg.get('payload', {}))
            
            # Prepare Frontmatter Metadata
            def _sanitize(val):
                if isinstance(val, str):
                    # escape quotes so yaml.dump will produce valid output
                    return val.replace('"', '\\"')
                return val

            metadata = {
                "title": _sanitize(subject),
                "id": msg_id,
                "type": "Received",
                "sender": _sanitize(sender),
                "recipients": _sanitize(to),
                "date": date_str,
                "category": "Main",
                "archived": False,
                "spam": False,
                "is_starred": False,
                "thread_id": thread_id,
                "gmail_id": msg_id,
                "database_table_id": "mail"
            }
            
            import yaml
            # Use allow_unicode=True and sort_keys=False for a cleaner look
            yaml_frontmatter = yaml.dump(metadata, default_flow_style=False, sort_keys=False, allow_unicode=True)
            full_content = f"---\n{yaml_frontmatter}---\n\n{body}\n"
            
            file_path.write_text(full_content, encoding="utf-8")
            log.info(f"Synced email to Vault: {filename}")
            return True

        except Exception as e:
            log.error(f"Error syncing message {msg_id}: {e}")
            return False

    def _extract_body(self, payload):
        """Recursively extracts the plain text body from the Gmail payload."""
        if 'parts' in payload:
            for part in payload['parts']:
                body = self._extract_body(part)
                if body:
                    return body
        
        if payload.get('mimeType') == 'text/plain':
            data = payload.get('body', {}).get('data', '')
            if data:
                return base64.urlsafe_b64decode(data).decode('utf-8', errors='replace')
        
        return ""

sync_service = VaultMailSyncService()
