# Gnosi 3 data and secret migration

Gnosi 3 separates source code, synchronized Vault content and per-device
runtime state. The code checkout can be replaced safely; the data directory
contains SQLite databases, caches, indexes, logs and encrypted fallback
credentials and must stay on a local filesystem.

## Canonical data directory

`GNOSI_DATA_DIR` is the only canonical override. Defaults are:

| Runtime | Default |
| --- | --- |
| macOS | `~/Library/Application Support/Gnosi` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/gnosi` |
| Windows | `%APPDATA%\Gnosi` |
| Docker | `/data` |

`GNOSI_LOCAL_DATA` is accepted with a deprecation warning throughout Gnosi
3.x. New scripts, services and deployment definitions must use
`GNOSI_DATA_DIR`.

## Environment and secrets

Effective precedence is process environment, the repository-local `.env`, then
an optional shared file named explicitly by `GNOSI_SHARED_ENV_FILE`. Gnosi does
not search parent directories for `.env_shared` and neither APIs nor settings
screens write to the shared file.

Credentials saved through the interface go to the operating-system credential
store. When no native store is available, Gnosi uses an encrypted file and a
random installation key below `GNOSI_DATA_DIR/secrets`, both restricted to the
current user. Existing legacy fallback values can be read for migration, but
new plaintext fallback writes are rejected.

## Plan and execute a move

Stop the backend, frontend, desktop app, scheduler and related LaunchAgents.
Confirm that ports 5002 and 5173 are closed. Then inspect the plan:

```bash
uv run python scripts/migrate-data-dir.py plan \
  /absolute/legacy/data \
  "/absolute/new/data"
```

Execute only after reviewing the reported method, size and database count:

```bash
uv run python scripts/migrate-data-dir.py migrate \
  /absolute/legacy/data \
  "/absolute/new/data" \
  --writers-stopped
```

The migrator checkpoints SQLite WAL files, runs `integrity_check`, records an
inventory and writes an atomic journal beside the destination. On one volume it
uses an atomic rename and automatically restores the source if destination
verification fails. Across volumes it copies to a unique staging directory,
verifies hashes and databases, atomically adopts the staging directory and
retains the source.

## Status, rollback and finalization

The migration command reports the journal path. It contains paths, phases,
file metadata and database results, never credential values.

```bash
uv run python scripts/migrate-data-dir.py status /absolute/journal.json
uv run python scripts/migrate-data-dir.py rollback /absolute/journal.json --writers-stopped
uv run python scripts/migrate-data-dir.py finalize /absolute/journal.json
```

Rollback is file-based and requires all writers to be stopped. It does not run
destructive reverse database migrations. Finalization removes only an empty
pre-migration destination scaffold; it never deletes a preserved cross-volume
source. Remove an old source manually only after the complete Gnosi 3
acceptance matrix has passed.

## References configuration outside the checkout

The references-table designation now lives at
`GNOSI_DATA_DIR/config/references.json`, including the deliberate disabled state,
linked-attachment base and unknown legacy fields. Native, Docker and desktop
use the same data-directory rule. Runtime never writes back to the former
`pipeline/skills/zotero_sync/zotero_db_config.json` file. If that legacy file
exists but the canonical file is missing, startup stops with a migration
instruction before database migrations or workers start. Disposable validation
never inspects the legacy file. A fresh installation needs no migration.

Stop every Gnosi writer and use explicit absolute paths (without symlinks):

```bash
uv run --frozen --no-sync python scripts/migrate-reference-config.py plan \
  /absolute/old-checkout/pipeline/skills/zotero_sync/zotero_db_config.json \
  /absolute/gnosi-data
uv run --frozen --no-sync python scripts/migrate-reference-config.py migrate \
  /absolute/old-checkout/pipeline/skills/zotero_sync/zotero_db_config.json \
  /absolute/gnosi-data --writers-stopped
```

Planning creates nothing. Execution keeps the original and verifies byte-for-byte
preservation, including unknown fields and formatting. Only the small JSON is
copied, not the data directory or its databases. The destination must be a trusted
local filesystem supporting hard links; unsupported filesystems fail without an
overwrite fallback. Publication is exclusive and newly created target, payload and
journal files are private (mode 600 on POSIX). An already-identical target is recorded as
pre-existing and is never owned by the migration. Different files, symlinks,
malformed or non-UTF-8 JSON, changed sources and competing migrations are rejected.

Use `status SOURCE DATA_DIR` to verify the journal without writes; repeat
`migrate SOURCE DATA_DIR --writers-stopped` to resume a prepared or published
transaction. The OS lock is released even if a process exits. Keep the hidden
`.references-migration.json` journal and `.references-migration.payload` alongside
the destination. A malformed or incomplete payload/journal requires operator
inspection; do not discard it or substitute guessed settings.

Use `rollback SOURCE DATA_DIR --writers-stopped` to reverse the configuration
migration. It verifies ownership and unchanged bytes before moving the migrated
target to `.references-migration.recovered.json`. Original, payload, journal and
recovered file remain available. A pre-existing target stays untouched. If Gnosi
has since changed/replaced the target, rollback refuses instead of losing those
settings. Stop writers and reconcile the files manually in that case. Rollback is
repeatable, but a rolled-back journal cannot silently publish again: preserve and
review its recovery artifacts before deliberately starting a new transaction.
Rolling back just this file is not a database downgrade or full 2.x rollback.

## SQLite schema upgrades

Gnosi upgrades its own SQLite databases through independent Alembic revision
lines for management, dynamic vaults, notebooks and each durable auxiliary
store. Startup accepts only an empty database, an exact reviewed Gnosi 2.x
schema fingerprint or an already versioned database. An unknown or drifted
schema stops startup without modifying the file.

Before starting Gnosi 3 against an existing data directory, stop every writer
and run the explicit migrator:

```bash
uv run python scripts/migrate-schemas.py --data-dir "/absolute/data/directory"
uv run python scripts/migrate-schemas.py --data-dir "/absolute/data/directory" --check
```

Every changed database receives an integrity-checked, SHA-256-recorded backup
under `backups/schema-migrations/`. The JSON Lines migration report contains
database identities relative to the data directory and no row values. Schema
rollback is deliberately file-based: stop writers and restore the verified
backup instead of running a destructive Alembic downgrade.

Developers can audit a data directory without reading row values and verify
that the committed compatibility manifest is reproducible:

```bash
uv run python scripts/audit-sqlite-schemas.py "/absolute/data/directory"
uv run python scripts/generate-schema-fingerprints.py \
  --output /tmp/gnosi-schema-fingerprints.json
```
