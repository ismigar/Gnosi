# Directive: Historical Notion export import

## Purpose

Import a local Notion CSV and Markdown export into Gnosi table directories,
writing YAML frontmatter and registry-defined embedded sections.

## Components

| Component | Responsibility |
|---|---|
| `pipeline/sandbox/import_from_export.py` | CSV and Markdown conversion |
| `pipeline/sandbox/sync_sections.py` | relation resolution and generated sections |
| `BD/vault_db_registry.json` | tables, properties, and section configuration |

## Conventions

- Configure the export directory explicitly; do not hard-code a user path.
- Use `<safe_title> <uuid32>.md`, exactly one file per UUID.
- Never append `-N`; if a title changes, remove the old same-UUID filename.
- Store reference-manager assets in the library location and other assets
  under table-specific `Assets/` directories with content deduplication.

## Resolved 2026-04-29 incident

Repeated imports created suffixed duplicates, section synchronization called a
missing wrapper, and registry loading performed repeated OneDrive directory
checks. Together these caused slow or hanging API requests.

The fix:

- enforces strict UUID idempotency;
- provides callable `sync_all_tables` and `sync_all_pages` wrappers;
- renders multi-column sections as Markdown tables;
- caches registry loading with stale fallback;
- performs table-directory checks once per process.

## Import flow

1. Load the registry.
2. For each exported database CSV, map rows and source Markdown.
3. Write frontmatter with normalized relation UUIDs and convert links to
   wikilinks.
4. Replace any previous same-UUID file.
5. Synchronize configured table and page sections.

Support complete, single-table, dry-run, and no-section-sync modes.

## Restrictions

- Avoid full-vault indexing while OneDrive is under heavy load.
- Some CSV rows have no individual Notion page body; import metadata and
  relations with an empty body.
- Preserve missing attachment references for later manual recovery and report
  them.
- Skip exported tables without their expected CSV and report them.
- Restart the native backend after manually adding a registry table so
  one-time directory setup runs, or use the table-creation endpoint.

This is a historical migration path. Current Notion cloning uses the live
clone services and configurable-schema workflow.
