# SKILL: Projectes Daily Backup

> ID: 2026-04-08
> Associated Script: monorepo/apps/gnosi/pipeline/skills/backup_projectes/scripts/backup_projectes.py
> Status: ACTIVE
> Version: 2.0 (Consolidated)

---

## 1. Objectives and Scope

*Maintain an up-to-date and efficient backup of the entire local development ecosystem to the cloud.*

- **Main Objective:** Perform a daily incremental backup of the `/Users/ismaelgarciafernandez/Projectes` folder to `/Users/ismaelgarciafernandez/Library/CloudStorage/OneDrive-UNED/Backups/Projectes`.
- **Success Criteria:** 
    - The destination folder is an exact replica (excluding temporary files).
    - The script generates a success log.
    - The OneDrive system correctly synchronizes changes to the cloud.

---

## 2. Input/Output (I/O) Specifications

### Inputs
- **Source Path:** `/Users/ismaelgarciafernandez/Projectes/`
- **Destination Path:** `/Users/ismaelgarciafernandez/Library/CloudStorage/OneDrive-UNED/Backups/Projectes/`
- **Exclusion List:**
    - `node_modules/`
    - `.venv/`
    - `__pycache__/`
    - `.DS_Store`
    - `.tmp/` (System temporary files)

### Outputs
- **Generated Artifacts:** Incremental replica in OneDrive (Local mirror).
- **Logs:** rsync registry and transfer statistics.

---

## 3. Logical Flow (Algorithm)
1. **Initialization:** Validate availability of the source and destination unit (OneDrive).
2. **Setup:** Ensure the folder structure at the destination exists.
3. **Execution:** Run `rsync` with archive parameters, deletion of orphaned files (`--delete`), and exclusions.
4. **Post-processing:** Record time and volume metrics in the log mailbox.

---

## 4. Tools and Libraries
- **System:** `rsync` (v3.x recommended for performance).
- **Python Wrapper:** The Python script manages pre-check logic and structured logging.

---

## 5. Restrictions and Edge Cases
- **File Locks:** Caution with open databases (sqlite). The script is designed to skip or retry locked files to avoid corruption in the backup.
- **OneDrive Sync:** The backup writes to the local FS. Uploading to the cloud depends on the macOS OneDrive application state.
- **Permissions:** Read access to the entire Projectes tree is required.

---

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 2026-02-09 | UnicodeDecodeError | `rsync` output with non-UTF-8 characters | Binary output capture and safe decoding. |
| 2026-04-08 | .sh vs .py Divergence | Duplicate memory in `docs/` | Consolidation of all logic into the skill's `SKILL.md`. |

---

## 7. Usage Examples

```bash
# Execution via pipeline
python monorepo/apps/gnosi/pipeline/skills/backup_projectes/scripts/backup_projectes.py
```
