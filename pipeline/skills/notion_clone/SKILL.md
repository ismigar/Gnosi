---
name: notion-clone
description: Repair and verify existing Gnosi Notion clones while preserving view tabs, deterministic IDs and edited content. Use for clone backfill, cleanup or exact schema/value comparison, not automatic live account access.
---

# Skill: Notion Clone

Tools for exact Notion-to-Gnosi cloning and incremental repair of missing view
tabs in existing clones.

> ID: NOTION-CLONE-20260708
> Stack: Gnosi's Python 3.11 environment with `httpx`, `yaml`, and a running backend

## View-tab model

Notion groups multiple table, board, or gallery views as **tabs** under one
linked-database block. MCP fetch returns every tab as
`<view url>{json}</view>`. Clone v1 used `.search()` and kept only the first,
reducing ten or thirteen tabs to one.

The corrected **anchor plus `tabs`** model keeps only the first view embed in
the page body as the anchor. Remaining views are created in the registry and
referenced from the anchor's `tabs` field. `DbViewEmbed` reads
`anchorReg.tabs` and renders the group like Notion.

The `tabs` field passes through registry JSON because `ViewSection` uses
`extra='allow'` and `update_view` merges by key. No data-model migration is
required.

## Scripts

| Script | Use |
|---|---|
| [`scripts/backfill_notion_views.py`](./scripts/backfill_notion_views.py) | Recover tabs 2 through N that clone v1 omitted without recloning or overwriting edited content |
| [`scripts/verify_notion_table_exact.py`](./scripts/verify_notion_table_exact.py) | Compare one live Notion database with its Gnosi clone schema and values |
| [`scripts/cleanup_notion_views.py`](./scripts/cleanup_notion_views.py) | Inspect and repair duplicate or misplaced cloned view embeds; review its dry-run output before applying |

### `verify_notion_table_exact.py`

The verifier uses the configured Notion REST integration and the deterministic
clone IDs. It compares property definitions and order, row IDs, structured
values, and undeclared frontmatter keys. Relation wikilink labels are treated
as storage decoration; the relation IDs must still match.

```bash
GNOSI_DATA_DIR="/path/to/gnosi-data" \
DIGITAL_BRAIN_VAULT_PATH="/path/to/vault" \
.venv/bin/python pipeline/skills/notion_clone/scripts/verify_notion_table_exact.py \
    --database-id <notion-db-id> \
    --vault "/path/to/vault"
```

### `backfill_notion_views.py`

Requirements:

- Native backend running on `uvicorn :5002`.
- Connected Notion MCP integration through OAuth.
- `GNOSI_DATA_DIR` pointing to Gnosi's configured data directory. Let the
  integration manager resolve credentials; do not read a guessed secrets file.
- An existing cloned vault on local disk. Cloud-synchronized folders must be
  available locally regardless of whether the provider is OneDrive, Google
  Drive, Nextcloud or another service; this is not a remote storage adapter.

Workflow:

1. Scan Markdown files containing `gnosi-view:def`, excluding `.history`,
   `.trash`, `Assets`, and other ignored directories.
2. Map Vault pages back to Notion pages by enumerating IDs through
   `import-config`, `query_database`, and the `search_pages` fallback.
   `uuid5` is one-way.
3. Fetch each page through MCP and call `build_clone_views` for every real tab,
   excluding suggested charts.
4. Reconcile state: keep only the anchor embed in the body, upsert every view
   through `POST /views`, assign `tabs` to the anchor, delete incorrect charts,
   and remove stacked `gnosi-view:def` blocks through `PATCH /pages/{id}`.

IDs are deterministic, so the operation is idempotent. It is a dry run by
default. Use `--apply` to write and `--state <jsonl>` to resume.

```bash
.venv/bin/python pipeline/skills/notion_clone/scripts/backfill_notion_views.py \
    --vault-dir /path/to/cloned-vault \
    --vault-id <vault-id> [--apply] [--only .Dashboards] [--state /tmp/state.jsonl]
```

The summary reports `pages`, `views_upserted`, `embeds_added`, `unmapped`,
`mcp_empty`, `errors`, and `chart_views_deleted`.

Tests use synthetic provider responses and disposable vaults. A dry run can
still read the configured provider; do not run it against real accounts as a
documentation check. Preserve opaque metadata and tab order when narrowing
types; malformed traversed structures must fail before unsafe writes. Keep
resume state outside source and review the operation before using `--apply`.
