# Notification Service Skill

## Overview
This skill provides a unified dispatcher for system notifications in Gnosi. It supports dual persistence (Database + Markdown) and native macOS alerts.

## Protocol
The service should be used by other background services (Sync, Backup, Rules) to inform the user about events or failures.

### Usage
```python
from pipeline.skills.notification_service.scripts.notification_service import notify

notify("Sync Complete", "All contacts are up to date.", level="SUCCESS")
```

## Channels
1. **DB (Database):** Saves to `notifications` table in `gnosi.db`.
2. **MD (Markdown):** Appends to `vault/system/notifications.md`.
3. **OS (macOS):** Displays a system notification bubble.

## Maintenance
- Ensure the `notifications` table exists in the management DB.
- The `notifications.md` file is automatically initialized if missing.
