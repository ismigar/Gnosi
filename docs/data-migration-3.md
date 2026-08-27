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
