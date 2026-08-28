import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, TypeAlias, cast

import yaml

from backend.config.app_config import load_params
from backend.services.google_calendar_service import get_google_calendar_service
from backend.utils.safe_io import guard_windows_reserved, safe_write_text

log = logging.getLogger(__name__)
JsonMap: TypeAlias = dict[str, Any]


def _object_items(payload: Any, key: str) -> list[JsonMap]:
    if not isinstance(payload, dict):
        return []
    raw = payload.get(key) or []
    if not isinstance(raw, list):
        return []
    return [cast(JsonMap, item) for item in raw if isinstance(item, dict)]

# Subscribed calendars that we do NOT want to sync to the vault. Google publishes
# automatic subscriptions (sunrise/sunset per city, moon phases, etc.)
# that generate thousands of daily single-event events — noise that saturates
# Calendar/External and, as OneDrive on-demand placeholders, gets stuck
# the indexer from Docker (`OSError: [Errno 35] Resource deadlock avoided`).
# Substring match on the calendar's `summary` (case-insensitive,
# multilingual because Google can localize the name according to the account's language).
_EXCLUDED_CALENDAR_SUMMARY_PATTERNS = (
    "sortida i posta de sol",   # CA
    "fases de la lluna",        # CA
    "salida y puesta del sol",  # ES
    "fases de la luna",         # ES
    "sunrise and sunset",       # EN
    "moon phases",              # EN
)


class VaultCalendarSyncService:
    def __init__(self) -> None:
        self.config = load_params()
        raw_vault = self.config.paths.get("VAULT")
        self.vault_path = Path(raw_vault) if raw_vault else None
        self.calendar_folder = self.vault_path / "Calendar" if self.vault_path else None
        
        if self.calendar_folder:
            try:
                self.calendar_folder.mkdir(parents=True, exist_ok=True)
            except Exception:
                pass

    def sync_all_calendars(
        self,
        days_back: int = 500,
        days_forward: int = 365,
    ) -> int:
        """Syncs all configured Google Calendars to the Vault."""
        from backend.services.integration_manager import integration_manager
        integrations = integration_manager.get_all_safe()
        
        synced_total = 0
        for cal in integrations.get("calendars", []):
            if cal.get("provider") == "google":
                email = cal.get("email") or cal.get("username")
                if email:
                    email_text = str(email)
                    log.info("Syncing Google Calendar for %s...", email_text)
                    count = self.sync_calendar(email_text, days_back, days_forward)
                    synced_total += count
        
        return synced_total

    @staticmethod
    def _calendar_slug(calendar_id: str, summary: str, email: str) -> str:
        if calendar_id in {"primary", email}:
            return "primary_calendar"
        slug = "".join(
            character
            for character in summary
            if character.isalnum() or character in (" ", "-", "_")
        ).strip().replace(" ", "_").lower()
        if not slug:
            slug = calendar_id.replace("@", "_").replace(".", "_")
        return guard_windows_reserved(slug)

    @staticmethod
    def _cleanup_markdown(folder: Path, retained_names: set[str]) -> None:
        for existing_file in folder.glob("*.md"):
            if existing_file.name in retained_names:
                continue
            try:
                existing_file.unlink()
                log.info(
                    "Cleanup: Deleted old/removed calendar event file: %s",
                    existing_file.name,
                )
            except OSError as exc:
                log.error("Failed to delete old file %s: %s", existing_file, exc)

    def _sync_calendar_entry(
        self,
        service: Any,
        email: str,
        account_base_folder: Path,
        calendar_entry: JsonMap,
        time_min: str,
        time_max: str,
    ) -> int:
        calendar_id = str(calendar_entry.get("id") or "").strip()
        if not calendar_id:
            return 0
        summary = str(calendar_entry.get("summary") or "Unknown")
        summary_lc = summary.lower()
        if any(pattern in summary_lc for pattern in _EXCLUDED_CALENDAR_SUMMARY_PATTERNS):
            log.info("Skipping noise calendar '%s' for %s", summary, email)
            return 0

        calendar_folder = account_base_folder / self._calendar_slug(
            calendar_id,
            summary,
            email,
        )
        calendar_folder.mkdir(parents=True, exist_ok=True)
        log.info("Syncing calendar '%s' (%s) for %s...", summary, calendar_id, email)

        events_result = service.events().list(
            calendarId=calendar_id,
            timeMin=time_min,
            timeMax=time_max,
            singleEvents=True,
            orderBy="startTime",
        ).execute()
        events = _object_items(events_result, "items")
        synced_filenames: set[str] = set()
        synced_count = 0
        source_label = email if calendar_id in {"primary", email} else f"{email} - {summary}"
        for event in events:
            file_path = self._sync_single_event(calendar_folder, event, source_label)
            if file_path is not None:
                synced_count += 1
                synced_filenames.add(file_path.name)
        self._cleanup_markdown(calendar_folder, synced_filenames)
        return synced_count

    def sync_calendar(
        self,
        email: str,
        days_back: int = 500,
        days_forward: int = 365,
    ) -> int:
        """Syncs all accessible Google Calendars for a specific account to the Vault."""
        service = get_google_calendar_service(email)
        if not service:
            log.error("Could not initialize Google Calendar service for %s", email)
            return 0
        if self.calendar_folder is None:
            log.error("Could not sync Google Calendar without a configured Vault")
            return 0

        try:
            # Use timezone-aware UTC; Google Calendar API expects RFC3339.
            # `.utcnow()` is deprecated and produces naive datetimes that
            # silently break comparisons with timezoned datetimes.
            now = datetime.now(timezone.utc)
            time_min = (now - timedelta(days=days_back)).isoformat().replace(
                "+00:00", "Z"
            )
            time_max = (now + timedelta(days=days_forward)).isoformat().replace(
                "+00:00", "Z"
            )

            # Get the list of all calendars (including shared ones)
            calendar_list_result = service.calendarList().list().execute()
            calendar_entries = _object_items(calendar_list_result, "items")
            
            # Create base folder for this email
            account_slug = email.replace("@", "_").replace(".", "_")
            account_base_folder = self.calendar_folder / "External" / account_slug
            account_base_folder.mkdir(parents=True, exist_ok=True)

            synced_total = sum(
                self._sync_calendar_entry(
                    service,
                    email,
                    account_base_folder,
                    calendar_entry,
                    time_min,
                    time_max,
                )
                for calendar_entry in calendar_entries
            )

            # Cleanup Level 2: Delete ANY .md files directly in the account_base_folder 
            # (In previous versions, events might have been placed here incorrectly)
            self._cleanup_markdown(account_base_folder, set())

            return synced_total
        except Exception as exc:
            log.error("Error during vault calendar sync for %s: %s", email, exc)
            return 0

    def _sync_single_event(
        self,
        target_folder: Path,
        event: JsonMap,
        source_label: str,
    ) -> Path | None:
        """Syncs a single Google Calendar event to a .md file in the Vault using a stable ID filename."""
        try:
            event_id = str(event.get("id") or "").strip()
            if not event_id:
                return None
            summary = str(event.get("summary") or "Untitled Event")
            
            start = event.get('start', {})
            start = cast(JsonMap, start) if isinstance(start, dict) else {}
            start_val = start.get('dateTime') or start.get('date')
            
            end = event.get('end', {})
            end = cast(JsonMap, end) if isinstance(end, dict) else {}
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
