---
name: notification-service
description: Use or maintain Gnosi's platform notification dispatcher and its legacy public import. Preserve independent database, per-device Markdown and best-effort OS channels.
---

# Notification Service Skill

## Overview
This skill provides the legacy public import for Gnosi's unified notification
dispatcher. The canonical implementation lives in
`backend/platform/notifications.py`; this skill facade preserves existing
automation imports without making application runtime depend on a skill script.

## Protocol
The service should be used by other background services (Sync, Backup, Rules) to inform the user about events or failures.

### Usage
```python
from backend.platform.notifications import notify

notify("Sync Complete", "All contacts are up to date.", level="SUCCESS")
```

## Channels
1. **DB (Database):** Saves to the `notifications` table through the management database service; do not hardcode a database filename.
2. **MD (Markdown):** Appends to
   `${GNOSI_DATA_DIR}/logs/notifications.md`, using the platform default when
   the variable is unset. This path is always per-device and never assumes
   OneDrive, Google Drive, Nextcloud, Dropbox, or another sync provider.
3. **OS (macOS):** Displays a system notification bubble.

## Maintenance
- Ensure the `notifications` table exists in the management DB.
- The `notifications.md` file is automatically initialized if missing.
- One failing channel must not prevent the remaining channels from receiving
  the event.
- The macOS channel is best effort; absence or failure of `osascript` returns
  `False` without breaking database or Markdown persistence.
