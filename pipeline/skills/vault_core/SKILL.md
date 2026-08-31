---
name: vault-core
description: Preserve Gnosi vault identifiers, internal links and active-vault context during file or metadata changes. Use for vault integrity work, not blanket normalization or cleanup of user documents.
---

# SKILL: Vault Core Management

This is the "master" skill that defines the fundamental integrity rules of the Gnosi Vault.

> ID: VAULT-CORE-20260408
> Status: ACTIVE

---

## 1. Identifier Policy (IDs)
The canonical field for any page is **`id`**.

- **Rule**: All pages must have an `id` field in the frontmatter.
- **Legacy**: `normalize_metadata_ids()` recognizes `source_id` and `gnosi_id`, including normalized spelling variants. An existing `id` wins. It does not treat `notion_id` as an interchangeable page identifier.
- **Automatic Backend**: Normalization is owned by `backend/domains/vault/pages/foundation.py` and used by the page write services. Preserve those boundaries; never run a blanket metadata rewrite merely because this skill was selected.

---

## 2. Internal Links and Transclusions (WikiLinks)
Protocol for file relationships.

- **Syntax**: `[[FILE_ID]]` or `[[FILE_ID|Custom Title]]`.
- **Transclusion**: `![[FILE_ID]]` to embed content.
- **Resolution**: The system searches for the ID throughout the entire Vault, regardless of the subfolder.

---

## 3. Path Management (Vault Path)
Definition of the knowledge root.

- **Config**: The path is defined in `DIGITAL_BRAIN_VAULT_PATH` through the
  process environment, Gnosi's local `.env`, or an explicit
  `GNOSI_SHARED_ENV_FILE`.
- **Tooling**: Use the existing path service for static configuration. Request-scoped operations use `backend/services/context_vars.py` to resolve the active vault; global integrations use the explicit primary-vault accessor. Do not flatten these distinct owners into one cached path.
- **Restriction**: Do not use hardcoded paths like `./vault/`.
- **Per-device state**: `GNOSI_DATA_DIR` is not the vault. Databases and credentials stay in the data directory, not automatically in a synchronized document folder.

---

## 4. History and Learning (Learning Cycle)

| Date | Error / Learning | Root Cause | Solution / Refinement |
| --- | --- | --- | --- |
| 2024-03-08 | Path Duplicity | Hardcoded paths | Centralization in `paths_config.py`. |
| 2026-04-07 | Ghost Pages | Missing ID | Automated normalization implementation in the backend. |
| 2026-04-08 | Rule Dispersion | Docs vs Reality | Creation of this Core Skill as the "Constitution" of the Vault. |

---
*Maintenance: Any change in transclusion syntax or filename policy must be reflected here first.*
