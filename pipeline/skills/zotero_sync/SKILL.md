---
name: zotero-sync-compatibility
description: Preserve the historical Zotero reference-table configuration path after Gnosi replaced bidirectional Zotero synchronization with its native reference manager.
---

# Zotero sync compatibility

## Purpose

This directory no longer contains synchronization code. It remains because
existing Gnosi 2.x installations store the designated References table in
`zotero_db_config.json`. Gnosi 3.x preserves that path while using its native
reference manager and Zotero-compatible capture and citation formats.

The current architecture and data contracts are documented in
[`reader-references.md`](../../../docs/engineering/domains/reader-references.md).

## Configuration contract

`zotero_db_config.json` may contain `target_table` and
`references_configured`. Runtime access belongs to
`backend/services/reference_table_config.py`.

- The real file is machine-specific and gitignored.
- `zotero_db_config.json.example` is the only tracked example.
- Absence of the real file is valid; the backend starts with defaults and the
  table can be selected from the interface.
- Keep this directory name throughout Gnosi 3.x. Renaming it requires an
  explicit, tested data migration.

## Restrictions and edge cases

- Do not restore the removed Zotero-to-Vault or Vault-to-Zotero scripts.
- Do not add backup scripts or paths tied to OneDrive, Google Drive,
  Nextcloud, Dropbox, or another storage provider.
- Do not place credentials or a real table identifier in the tracked example.
- Zotero's optional translation server is a metadata adapter; it is not the
  removed synchronization workflow.
- Historical removals remain available through Git history and must not be
  copied into an active repository merely for archival purposes.

## Verification

Confirm that the backend starts both with the configuration absent and with a
temporary configuration selecting a synthetic table. Validate that generated
documentation lists this compatibility skill and that no tracked file contains
a machine-specific cloud-storage path.
