# SKILL: Chat Media Purge Maintenance

> ID: 20260209-PURGE
> Associated Script: monorepo/apps/gnosi/pipeline/sandbox/purge_chat_media.py
> Status: DRAFT

---

## 1. Objectives and Scope

*This protocol defines how to clean up old files from messaging applications (WhatsApp and Telegram) to prevent disk space exhaustion.*

- **Main Objective:** Automatically delete multimedia files (photos, videos, audio) from WhatsApp and Telegram that are more than 7 days old.
- **Success Criteria:** Files with a modification date older than 7 days in the specified paths are deleted, freeing up space without affecting the message database.

---

## 2. Input/Output (I/O) Specifications

### Inputs
- **Required Arguments:**
    - `--days`: Integer - Number of days old to purge (default: 7).
    - `--dry-run`: Boolean - If true, only lists what would be deleted without deleting anything.
- **Source Directories:**
    - WhatsApp: `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/Message/Media`
    - Telegram: `~/Library/Group Containers/*.keepcoder.Telegram/appstore/account-*/postbox/resources`

### Outputs
- **Console Output:** Detailed summary of deleted files and total space freed in MB/GB.

---

## 3. Logical Flow (Algorithm)
1. **Initialization:** Validate that application paths exist.
2. **Scan:** Recursively traverse media folders looking for files.
3. **Filter:** Identify files whose last modification date (mtime) is greater than N days.
4. **Execution:** If not `dry-run`, delete the filtered files.
5. **Reporting:** Calculate the total size of deleted files and display the summary.

---

## 4. Tools and Libraries
- **Python libraries:** `os`, `time`, `pathlib`, `argparse`, `glob`.

---

## 5. Restrictions and Edge Cases
- **Root Folders:** DO NOT delete root folders or database folders (.sqlite). Only files within resource/media folders.
- **Permissions:** The script requires access permissions to the `Library` folder.
- **Integrity:** WhatsApp and Telegram should ideally be closed, although deleting only media usually does not corrupt the DB.

---

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 2026-02-09 | Permission Denied | macOS Sandbox | Ensure the script runs with sufficient permissions or warn the user. |

---

## 7. Usage Examples

```bash
# simulated 7-day purge
python purge_chat_media.py --days 7 --dry-run

# actual 7-day purge
python purge_chat_media.py --days 7
```

---

## 8. Pre-Execution Checklist
- [ ] WhatsApp/Telegram paths verified.
- [ ] Message backup (optional but recommended).

---

## 9. Post-Execution Checklist
- [ ] Freed space verified with `df -h`.
- [ ] Chat applications open correctly.
