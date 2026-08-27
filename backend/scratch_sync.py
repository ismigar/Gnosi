
import sys
import os
from pathlib import Path

# Add the app directory to the path so we can import the backend modules.
# We derive it from the location of this file (.../Gnosi/backend/scratch_sync.py
# on the host, /app/backend inside Docker) instead of an absolute path with a macOS user
# hardcoded, which broke on the other machine.
sys.path.append(str(Path(__file__).resolve().parent.parent))

import logging
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("manual_sync")

def run_sync():
    log.info("Starting manual Google Calendar sync...")
    try:
        from backend.services.vault_calendar_sync_service import calendar_sync_service
        count = calendar_sync_service.sync_all_calendars()
        log.info(f"Successfully synced {count} events across all accounts.")
        return count
    except Exception as e:
        log.error(f"Sync failed: {e}")
        import traceback
        log.error(traceback.format_exc())
        return -1

if __name__ == "__main__":
    run_sync()
