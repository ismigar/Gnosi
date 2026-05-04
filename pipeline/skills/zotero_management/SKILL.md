# SKILL: Zotero Management

This unified skill centralizes all maintenance operations and data extraction for Zotero.

> ID: ZOTERO-MGMT-20260408
> Context: Replaces the old fragmented backup and synchronization directives.

---

## 1. Module A: Library Backup (Files)
Performs an incremental daily backup of the entire data folder to OneDrive.

- **Objective**: Synchronize `~/Zotero` to `~/OneDrive/Backups/Zotero`.
- **Protocol**: Uses `rsync` to maintain an exact mirror, excluding temporary files.
- **Execution**:
  ```bash
  sh monorepo/apps/gnosi/pipeline/skills/zotero_management/scripts/backup_zotero.sh
  ```
- **Recovery**: To restore, close Zotero and copy from the OneDrive destination to the local path.

---

## 2. Module B: Metadata Synchronization (Data)
Extracts bibliographic references from `zotero.sqlite` and injects them into the local App database.

- **Objective**: Keep the reference table in the Vault updated.
- **Configuration**: `zotero_db_config.json` defines the field mapping.
- **Execution**:
  ```bash
  python monorepo/apps/gnosi/pipeline/skills/zotero_management/scripts/zotero_to_db.py
  ```
- **Safety**: The script creates a temporary copy of the Zotero DB to allow working even if Zotero is open.

---

## 3. Common Restrictions
- **Directionality**: Operations are one-way (Zotero -> App/Backup). Manual edits should not be made at the destinations expecting Zotero to update.
- **Integrity**: It is recommended to close Zotero before performing a full folder backup to guarantee the consistency of SQLite files.

---

## 4. History and Learning (Learning Cycle)

| Date | Error / Learning | Root Cause | Solution / Refinement |
| --- | --- | --- | --- |
| 2026-02-09 | UnicodeDecodeError | Rsync output | Safe decoding in the Python wrapper. |
| 2026-04-08 | Memory Fragmentation | Duplicate directives | Unification of Backup and Sync into a single `@Skill`. |

---
*Maintenance: If Zotero changes the default data path, the constants in the scripts and the JSON configuration must be updated.*
