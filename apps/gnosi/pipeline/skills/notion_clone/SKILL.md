# Skill: Notion Clone

Tools for exact Notion-to-Gnosi cloning and incremental repair of missing view
tabs in existing clones.

> ID: NOTION-CLONE-20260708
> Stack: Python 3.10+ with `httpx`, `yaml`, and a running Gnosi backend
> Directive: `docs/dev_memory/directives/notion_exact_clone.md`

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

### `verify_notion_table_exact.py`

The verifier uses the configured Notion REST integration and the deterministic
clone IDs. It compares property definitions and order, row IDs, structured
values, and undeclared frontmatter keys. Relation wikilink labels are treated
as storage decoration; the relation IDs must still match.

```bash
GNOSI_LOCAL_DATA="$PWD/local_data" \
DIGITAL_BRAIN_VAULT_PATH="/path/to/vault" \
.venv/bin/python pipeline/skills/notion_clone/scripts/verify_notion_table_exact.py \
    --database-id <notion-db-id> \
    --vault "/path/to/vault"
```

### `backfill_notion_views.py`

Requirements:

- Native backend running on `uvicorn :5002`.
- Connected Notion MCP integration through OAuth.
- `GNOSI_LOCAL_DATA` pointing to the data directory containing
  `integrations.json`.
- An existing cloned vault on local disk or OneDrive.

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
    --vault-dir ~/Library/CloudStorage/OneDrive-UNED/Gnosi/Notion \
    --vault-id <vault-id> [--apply] [--only .Dashboards] [--state /tmp/state.jsonl]
```

The summary reports `pages`, `views_upserted`, `embeds_added`, `unmapped`,
`mcp_empty`, `errors`, and `chart_views_deleted`.
