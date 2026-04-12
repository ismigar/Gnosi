import logging
import os
import json
import yaml
from pathlib import Path
from datetime import datetime, timedelta
from backend.services.google_calendar_service import get_google_calendar_service
from backend.config.app_config import load_params

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
            now = datetime.utcnow()
            time_min = (now - timedelta(days=days_back)).isoformat() + "Z"
            time_max = (now + timedelta(days=days_forward)).isoformat() + "Z"

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
                # Slugify common names but keep it readable
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
                for event in events:
                    # Provide a descriptive source: "email - Calendar Name"
                    source_label = f"{email} - {summary}" if calendar_id != 'primary' else email
                    if self._sync_single_event(calendar_folder, event, source_label):
                        synced_total += 1
            
            return synced_total
        except Exception as e:
            log.error(f"Error during vault calendar sync for {email}: {e}")
            return 0

    def _sync_single_event(self, target_folder: Path, event: dict, email: str):
        """Syncs a single Google Calendar event to a .md file in the Vault."""
        try:
            event_id = event.get('id')
            summary = event.get('summary', 'Untitled Event')
            
            start = event.get('start', {})
            start_val = start.get('dateTime') or start.get('date')
            
            end = event.get('end', {})
            end_val = end.get('dateTime') or end.get('date')
            
            description = event.get('description', '')
            location = event.get('location', '')
            
            # Use original ID in filename but make it safe
            # Filename pattern: YYYYMMDD_ID_Summary.md
            date_prefix = (start_val[:10].replace("-", "")) if start_val else "nodate"
            clean_summary = "".join([c for c in summary if c.isalnum() or c in (' ', '-', '_')]).strip()[:50]
            filename = f"{date_prefix}_{event_id}_{clean_summary}.md"
            file_path = target_folder / filename

            # metadata is basically what Gnosi expects for calendar items
            metadata = {
                "title": summary,
                "id": event_id,
                "date": start_val,
                "end_date": end_val,
                "location": location,
                "source": email,
                "uid": event_id,
                "all_day": 'dateTime' not in start,
                "status": event.get('status', 'confirmed'),
                "link": event.get('htmlLink', '')
            }
            
            # Check if exists and compare
            if file_path.exists():
                # We could check updated time, but for now let's overwrite if changed or just skip if exists
                # Google events have an 'updated' field
                pass

            full_content = f"---\n{yaml.dump(metadata, default_flow_style=False, sort_keys=False, allow_unicode=True)}---\n\n{description}\n"
            
            file_path.write_text(full_content, encoding="utf-8")
            return True

        except Exception as e:
            log.error(f"Error syncing event {event.get('id')}: {e}")
            return False

calendar_sync_service = VaultCalendarSyncService()
