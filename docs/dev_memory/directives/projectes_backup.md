# Directive: Projectes Daily Backup

> ID: projectes_daily_backup
> Associated Script: scripts/backup_projectes.sh
> Last Update: 2026-02-13
> Status: ACTIVE

---

## 1. Objectives and Scope

*Establish a reliable, daily backup of the Projectes development directory to OneDrive.*

- **Main Objective:** Sync `~/Projectes` to `~/Library/CloudStorage/OneDrive-UNED/Backups/Projectes/` protecting against data loss.
- **Success Criteria:**
    - Project files are replicated to OneDrive.
    - Build artifacts, caches, and sensitive system folders are excluded.
    - The process identifies success or failure in logs.

## 2. Input/Output (I/O) Specifications

### Inputs

- **Source:** `/Users/ismaelgarciafernandez/Projectes/`
- **Destination:** `/Users/ismaelgarciafernandez/Library/CloudStorage/OneDrive-UNED/Backups/Projectes/`

### Outputs

- **Replica:** A mirror of the Projectes folder in OneDrive, minus exclusions.
- **Log File:** `monorepo/apps/digital-brain/pipeline/sandbox/backup_projectes.log` containing `rsync` output and timestamps.

## 3. Logical Flow (Algorithm)

1. **Pre-check:** Ensure Source exists and Destination directory is created if missing.
2. **Execution:** Run `rsync` with archive mode (`-av`), delete extraneous files in destination (`--delete`), and exclude development artifacts.
3. **Logging:** Append start/end timestamps and exit status to log.

## 4. Tools and Libraries

- **System Tools:** `rsync`

## 5. Restrictions and Edge Cases

- **Exclusions:** It is critical to exclude `node_modules`, `.venv`, and `.git` (optional, but usually good to keep git, though heavy). *Correction: We usually keep .git for history, but exclude build artifacts.*
- **OneDrive Sync:** The destination is a synced folder. `rsync` writes to the local FS, and the OneDrive app handles the cloud sync.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| | | | |

## 7. Examples of Use

```bash
# Manual Run
sh scripts/backup_projectes.sh
```
