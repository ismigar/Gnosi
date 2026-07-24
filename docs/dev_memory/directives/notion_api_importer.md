# Notion API Importer

## Objective

Provide a reusable backend importer that reproduces a Notion workspace inside a
Gnosi vault: databases, pages, properties, relationships, Markdown content,
and downloaded files. The integration token is configured through the UI.

## Fidelity boundary

The public Notion REST API exposes schemas, pages, relationships, blocks, and
files. It does not expose complete view definitions. Phase 1 therefore imports
roughly 90% of the structure and generates heuristic views. Exact view filters,
sorts, grouping, and display properties require the optional MCP OAuth phase.

## Architecture

```text
backend/services/notion_importer.py
backend/api/notion_routes.py
frontend/src/.../NotionImportSettings.jsx
```

Store the token under `cfg.paths["SECRETS"]/integrations.json`, never in the
registry or vault.

Reuse Gnosi creation services or endpoints rather than writing files directly,
so authorship, folders, assets, atomic writes, and indexing remain consistent.

## Notion endpoints

- `POST /v1/search`
- `GET /v1/databases/{id}`
- `POST /v1/databases/{id}/query`
- `GET /v1/pages/{id}`
- `GET /v1/blocks/{id}/children`
- `/v1/users` for people resolution

Paginate every listing. Apply an average three-request-per-second throttle and
exponential retry for `429`, respecting `Retry-After`. Download expiring S3
file URLs immediately.

## Property mapping

| Notion | Gnosi |
|---|---|
| `title` | `title` |
| `rich_text` | `text` |
| `number` | `number` |
| `select` | `select` with rich options |
| `multi_select` | `multi_select` with rich options |
| `status` | `status` |
| `date` | `date`, or `period` when an end exists |
| `people` | `person` or resolved text |
| `files` | downloaded `file` assets |
| `checkbox` | `checkbox` |
| `url`, `email`, `phone` | corresponding field or text |
| `relation` | `relation`, wired in pass two |
| `formula`, `rollup` | stored read-only calculated value |
| created/edited metadata | native authorship fields |

## Block mapping

Map paragraphs, headings, lists, tasks, toggles, quotes, code, callouts,
dividers, tables, equations, bookmarks, media, child pages, child databases,
and synchronized blocks to their closest Markdown or Gnosi block equivalent.
Preserve rich-text emphasis, code, strike-through, links, and supported color
semantics.

Files and images are downloaded into the table's asset directory. Child
objects become stable Gnosi links.

## Transitive BFS import

`import_workspace` performs breadth-first traversal across:

- Database relation targets
- Child pages and child databases
- `link_to_page`
- Inline page mentions

Maintain visited sets for databases and pages so cyclic graphs terminate.
A discovered row whose parent is a database must import through that database,
not as an unscoped page.

`max_pages` defaults to 5000. When reached, return `truncated: true`; never
silently cut the graph. Request flags control following relationships and
children.

## Two-pass relationship resolution

1. Create every table and page while building Notion-to-Gnosi ID maps.
2. Translate relation IDs through those maps and patch the source records.
3. Run inverse-relation synchronization afterward.

Never wire a relation during pass one because its target may not exist yet.

## Views

The public API cannot reproduce Notion views exactly.

For each imported table:

1. Create a default table view with all properties.
2. Optionally create a second view grouped by a status field or the dominant
   select field.

Exact views are phase 2 through Notion MCP OAuth.

## API

- `POST /api/notion/token`: save and validate the token with `/v1/users/me`.
- `GET /api/notion/databases`: list databases shared with the integration.
- `POST /api/notion/import`: start an import and return table, page,
  relationship, file, and error counts.

A long import should eventually become a progress job using SSE.

## Existing-vault reconciliation

The current vault was originally seeded from Notion and retains raw Notion IDs.
Its translated and edited content has since diverged.

Rules:

1. Match by exact raw ID first, with title only as a diagnostic fallback.
2. Default to a dry-run diff.
3. Never overwrite a diverged vault page without explicit confirmation.
4. Add genuinely new `notion_only` pages safely.
5. Compare embedded views by count and section, not literal serialized text.

`services/notion_diff.py` provides pure, tested comparison helpers and returns
body similarity, body status, embedded-view summaries, and a safe action.

Do not use UUID5 IDs for this existing vault; doing so would duplicate pages.
Do not overwrite by raw ID without a diff; doing so would destroy translated
and edited work.

## Restrictions

- Download expiring files during the import.
- Paginate search, queries, blocks, and users.
- Do not aggressively parallelize against the Notion rate limit.
- Store formula and rollup results; do not attempt to recalculate them.
- Normalize select options to rich option objects.
- Make fresh imports idempotent by stable source ID.
- Treat existing-vault reconciliation as synchronization, not migration.
- Preserve user content in its chosen language.

## QA gates

1. Pure mapping tests use synthetic Notion fixtures without a live token.
2. BFS tests cover cycles, child pages, row-to-database routing, references,
   and truncation.
3. Diff tests cover identical, similar, diverged, and new pages.
4. A live E2E import uses a test database and verifies schema, rows,
   relationships, content, files, and browser rendering.
5. “Could not test” is not completion.

## Phases

- Phase 1: public REST API, heuristic views, and tested transforms.
- Phase 2: optional MCP OAuth for exact view fidelity and SSE progress.
