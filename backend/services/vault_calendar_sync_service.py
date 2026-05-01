import logging
import os
import json
import yaml
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any, Set
from backend.services.google_calendar_service import get_google_calendar_service
from backend.config.app_config import load_params
from backend.utils.safe_io import safe_write_text

log = logging.getLogger(__name__)

class VaultCalendarSyncService:
    def __init__(self):
        self.config = load_params()
        raw_vault = self.config.paths.get("VAULT")
        self.vault_path = Path(raw_vault) if raw_vault else None
        self.calendar_folder = self.vault_path / "Calendar" if self.vault_path else None
        
        if self.calendar_folder:
            try:
                self.calendar_folder.mkdir(parents=True, exist_ok=True)
            except Exception:
                pass

    def sync_all_calendars(self, days_back: int = 500, days_forward: int = 365):
        """Syncs all configured Google Calendars to the Vault."""
        from backend.services.integration_manager import integration_manager
        integrations = integration_manager.get_all_safe()
        
        synced_total = 0
        for cal in integrations.get("calendars", []):
            if cal.get("provider") == "google":
                email = cal.get("email") or cal.get("username")
                if email:
                    log.info(f"Syncing Google Calendar for {email}...")
                    count = self.sync_calendar(email, days_back, days_forward)
                    synced_total += count
        
        return synced_total

    def sync_calendar(self, email: str, days_back: int = 500, days_forward: int = 365):
        """Syncs all accessible Google Calendars for a specific account to the Vault."""
        service = get_google_calendar_service(email)
        if not service:
            log.error(f"Could not initialize Google Calendar service for {email}")
            return 0

        try:
            # Use timezone-aware UTC; Google Calendar API expects RFC3339.
            # `.utcnow()` is deprecated and produces naive datetimes that
            # silently break comparisons with timezoned datetimes.
            now = datetime.now(timezone.utc)
            time_min = now - timedelta(days=days_back)
            time_max = now + timedelta(days=days_forward)
            time_min = time_min.isoformat().replace("+00:00", "Z")
            time_max = time_max.isoformat().replace("+00:00", "Z")

            # Get the list of all calendars (including shared ones)
            calendar_list_result = service.calendarList().list().execute()
            calendar_entries = calendar_list_result.get('items', [])
            
            synced_total = 0
            
            # Create base folder for this email
            account_slug = email.replace("@", "_").replace(".", "_")
            account_base_folder = self.calendar_folder / "External" / account_slug
            account_base_folder.mkdir(parents=True, exist_ok=True)

            for calendar_entry in calendar_entries:
                calendar_id = calendar_entry.get('id')
                summary = calendar_entry.get('summary', 'Unknown')
                
                # Create subfolder for this specific calendar
                if calendar_id == 'primary' or calendar_id == email:
                    calendar_slug = "primary_calendar"
                else:
                    calendar_slug = "".join([c for c in summary if c.isalnum() or c in (' ', '-', '_')]).strip().replace(" ", "_").lower()
                    if not calendar_slug: calendar_slug = calendar_id.replace("@", "_").replace(".", "_")
                
                calendar_folder = account_base_folder / calendar_slug
                calendar_folder.mkdir(parents=True, exist_ok=True)

                log.info(f"Syncing calendar '{summary}' ({calendar_id}) for {email}...")
                
                events_result = service.events().list(
                    calendarId=calendar_id,
                    timeMin=time_min,
                    timeMax=time_max,
                    singleEvents=True,
                    orderBy='startTime'
                ).execute()
                
                events = events_result.get('items', [])
                synced_filenames = set()

                for event in events:
                    # Provide a descriptive source: "email - Calendar Name"
                    # If it's the primary calendar (ID matches email or is 'primary'), use only email
                    is_primary = (calendar_id == 'primary' or calendar_id == email)
                    source_label = f"{email} - {summary}" if not is_primary else email
                    
                    file_path = self._sync_single_event(calendar_folder, event, source_label)
                    if file_path:
                        synced_total += 1
                        synced_filenames.add(file_path.name)
                
                # Cleanup: Delete files in this folder that are NOT in synced_filenames
                # This handles both deleted events and migration from old filename format
                for existing_file in calendar_folder.glob("*.md"):
                    if existing_file.name not in synced_filenames:
                        try:
                            existing_file.unlink()
                            log.info(f"Cleanup: Deleted old/removed calendar event file: {existing_file.name}")
                        except Exception as e:
                            log.error(f"Failed to delete old file {existing_file}: {e}")

            # Cleanup Level 2: Delete ANY .md files directly in the account_base_folder 
            # (In previous versions, events might have been placed here incorrectly)
            for loose_file in account_base_folder.glob("*.md"):
                try:
                    loose_file.unlink()
                    log.info(f"Cleanup: Deleted loose file from account root: {loose_file.name}")
                except Exception as e:
                    log.error(f"Failed to delete loose file {loose_file}: {e}")

            return synced_total
        except Exception as e:
            log.error(f"Error during vault calendar sync for {email}: {e}")
            return 0

    def _sync_single_event(self, target_folder: Path, event: dict, source_label: str) -> Optional[Path]:
        """Syncs a single Google Calendar event to a .md file in the Vault using a stable ID filename."""
        try:
            event_id = event.get('id')
            summary = event.get('summary', 'Untitled Event')
            
            start = event.get('start', {})
            start_val = start.get('dateTime') or start.get('date')
            
            end = event.get('end', {})
            end_val = end.get('dateTime') or end.get('date')
            
            description = event.get('description', '')
            location = event.get('location', '')
            
            # STABLE FILENAME: Use only the event_id to ensure updates overwrite the same file
            # Sanitize ID just in case (Google IDs are usually URL-safe base64-like)
            safe_id = "".join([c for c in event_id if c.isalnum() or c in ('-', '_')]).strip()
            filename = f"{safe_id}.md"
            file_path = target_folder / filename

            metadata = {
                "title": summary,
                "id": event_id,
                "date": start_val,
                "end_date": end_val,
                "location": location,
                "source": source_label,
                "uid": event_id,
                "all_day": 'dateTime' not in start,
                "status": event.get('status', 'confirmed'),
                "link": event.get('htmlLink', '')
            }
            
            # Additional detail for recurring events or updated timestamps
            updated = event.get('updated')
            if updated:
                metadata["updated_at"] = updated

            full_content = f"---\n{yaml.dump(metadata, default_flow_style=False, sort_keys=False, allow_unicode=True)}---\n\n{description}\n"
            
            # Only write if changed? (Optimistic overwrite for now for simplicity)
            safe_write_text(file_path, full_content)
            return file_path

        except Exception as e:
            log.error(f"Error syncing event {event.get('id')}: {e}")
            return None

calendar_sync_service = VaultCalendarSyncService()
