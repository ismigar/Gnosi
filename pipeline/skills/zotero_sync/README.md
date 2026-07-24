# `zotero_sync` directory (historical configuration only)

> **This directory no longer contains synchronization code.** Zotero-to-Vault
> sync was removed when Gnosi became the native reference manager. See
> [`gnosi_native_reference_manager.md`](../../../../../docs/dev_memory/directives/gnosi_native_reference_manager.md).

## Remaining configuration

`zotero_db_config.json` stores the Vault's designated **References table**:
`target_table` and `references_configured`. Live code reads it through
[`backend/services/reference_table_config.py`](../../../backend/services/reference_table_config.py).

The file is machine-specific and gitignored because it contains the actual
`target_table` and can include credentials. The repository tracks
`zotero_db_config.json.example`. For a new clone:

```bash
cp zotero_db_config.json.example zotero_db_config.json
```

The file is optional. When it does not exist, `load_json` returns the default,
the backend starts normally, and the table can be selected from the UI.

## Why the historical name remains

Existing production installations use this JSON path. Renaming the directory
would require a runtime file migration, so the historical name remains for
compatibility. It does not mean synchronization still exists.

## Removed files

Inspect removal history with:

```bash
git log --diff-filter=D --summary -- pipeline/skills/zotero_sync/
```

The deprecated sync cleanup removed:

- `SKILL.md`: old synchronization documentation.
- `scripts/zotero_to_vault.py`: subprocess Zotero-to-Vault sync.
- `scripts/gnosi_to_zotero.py`: Vault-to-Zotero sync.
- `scripts/backup_zotero.sh`: Zotero library backup to OneDrive.
- `scripts/zotero_enrich.py`: initial enrichment-only migration.
- `scripts/zotero_migrate_annotations.py`: PDF annotation migration.
