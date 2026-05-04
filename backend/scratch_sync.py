
import sys
import os
from pathlib import Path

# Afegir el directori de l'app al path per poder importar els mòduls del backend
sys.path.append("/Users/ismaelgarciafernandez/Projectes/monorepo/apps/gnosi")

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
