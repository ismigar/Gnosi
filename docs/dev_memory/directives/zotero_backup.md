# Directive: Zotero Daily Backup

> ID: zotero_daily_backup
> Associated Script: scripts/backup_zotero.sh
> Last Update: 2026-02-13
> Status: ACTIVE

---

## 1. Objectives and Scope

*Establish a reliable, daily backup of the Zotero data library to OneDrive.*

- **Main Objective:** Sync `~/Zotero` to `~/OneDrive/Zotero` protecting against data loss.
- **Success Criteria:**
    - Zotero database and storage files are replicated to OneDrive.
    - The process runs daily at 20:00.
    - Logs confirm successful execution.

## 2. Input/Output (I/O) Specifications

### Inputs

- **Source:** `/Users/ismaelgarciafernandez/Zotero` (Zotero Data Directory)
- **Destination:** `/Users/ismaelgarciafernandez/OneDrive/Backups/Zotero`

### Outputs

- **Replica:** An exact mirror of the Zotero folder in OneDrive.
- **Log File:** `~/backup_zotero.log` containing `rsync` output and timestamps.

## 3. Logical Flow (Algorithm)

1. **Pre-check:** Ensure Source exists and Destination is reachable.
2. **Execution:** Run `rsync` with archive mode (`-av`) and delete extraneous files in destination (`--delete`) to maintain an exact mirror.
3. **Logging:** Append start/end timestamps and exit status to log.

## 4. Tools and Libraries

- **System Tools:** `rsync`, `cron`.

## 5. Restrictions and Edge Cases

- **Open Files:** If Zotero is open, `zotero.sqlite` might be locked or in a changing state. `rsync` usually handles this fine for a snapshot, but ideally, Zotero should be closed to ensure perfect data integrity.
- **Network Volumes:** OneDrive is a sync folder. Rapid changes might trigger OneDrive sync activity. This is expected.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| | | | |

## 7. Examples of Use

```bash
# Manual Run
sh ~/Projectes/scripts/backup_zotero.sh
```

## 8. Recovery

To restore:
1. Close Zotero.
2. Rename current `~/Zotero` to `~/Zotero_old` (safety).
3. Copy from backup: `cp -r ~/OneDrive/Backups/Zotero ~/Zotero`.
4. Open Zotero.
