# SKILL: Vault Core Management

This is the "master" skill that defines the fundamental integrity rules of the Gnosi Vault.

> ID: VAULT-CORE-20260408
> Status: ACTIVE

---

## 1. Identifier Policy (IDs)
The canonical field for any page is **`id`**.

- **Rule**: All pages must have an `id` field in the frontmatter.
- **Legacy**: `source_id` and `notion_id` fields are obsolete and must be normalized → `id`.
- **Automatic Backend**: The server normalizes these fields on every write (`normalize_metadata_ids()`).

---

## 2. Internal Links and Transclusions (WikiLinks)
Protocol for file relationships.

- **Syntax**: `[[FILE_ID]]` or `[[FILE_ID|Custom Title]]`.
- **Transclusion**: `![[FILE_ID]]` to embed content.
- **Resolution**: The system searches for the ID throughout the entire Vault, regardless of the subfolder.

---

## 3. Path Management (Vault Path)
Definition of the knowledge root.

- **Config**: The path is defined in `DIGITAL_BRAIN_VAULT_PATH` (.env_shared).
- **Tooling**: All scripts must use `get_paths()` from `backend/config/paths_config.py`.
- **Restriction**: Do not use hardcoded paths like `./vault/`.

---

## 4. History and Learning (Learning Cycle)

| Date | Error / Learning | Root Cause | Solution / Refinement |
| --- | --- | --- | --- |
| 2024-03-08 | Path Duplicity | Hardcoded paths | Centralization in `paths_config.py`. |
| 2026-04-07 | Ghost Pages | Missing ID | Automated normalization implementation in the backend. |
| 2026-04-08 | Rule Dispersion | Docs vs Reality | Creation of this Core Skill as the "Constitution" of the Vault. |

---
*Maintenance: Any change in transclusion syntax or filename policy must be reflected here first.*
