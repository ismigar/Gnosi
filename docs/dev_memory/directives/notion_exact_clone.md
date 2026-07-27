# Exact Notion Clone

## Objective

Create an easy, high-fidelity Notion workspace clone in Gnosi, including
embedded views, columns, content, and schema. This is distinct from guarded
synchronization: the user explicitly accepts that the clone reflects Notion.

## Safety decision

The clone always lands in a new folder such as `Notion Clone/` and never
modifies the current vault. Tables, pages, and views use namespaced IDs so they
cannot reconcile with or overwrite existing records.

Exact view fidelity requires the hosted Notion MCP connection. The public REST
API is insufficient.

## Existing components

- `notion_view_recreator.py`: parse MCP pages and views and build Gnosi views.
- `notion_mcp_md.py`: convert MCP Markdown and custom tags.
- MCP HTTP/OAuth client and Notion OAuth routes.
- REST importer for schema, relationships, and asset downloads.

## Clone orchestration

`services/notion_clone.py` and `mode="clone"`:

1. Derive namespaced table and page IDs from source IDs.
2. Import every table row and standalone page into the new clone folder.
3. Fetch page content through MCP and convert it to Gnosi Markdown.
4. Resolve database markers into namespaced Gnosi view definitions.
5. Map relationships to namespaced clone IDs.
6. Map schemas through the established REST property mapper.
7. Download files into clone assets.

The UI exposes “Exact clone to a new folder” separately from guarded sync and
requires an active MCP connection.

## Multi-tab views

A linked database block may contain multiple `<view>` entries. Always use
`parse_mcp_views`; reading only the first silently loses tabs.

Create one Gnosi view per Notion tab:

- Embed the first view as the anchor.
- Store remaining view IDs in the anchor's `tabs`.
- Preserve the legacy first-view ID for compatibility.
- Derive later tab IDs with the source view URL.

The frontend reads and persists `tabs` through the registry.

Suggested chart views not visible in the source block are skipped by default.
Map supported advanced filters, chart configuration, calendar/timeline date
fields, and option values. Discard status-group filters that cannot map safely.

For an existing clone, use the tracked
`pipeline/skills/notion_clone/scripts/backfill_notion_views.py`. It is
dry-run-first, resumable, and updates views without replacing edited content.

## Attachments and toggles

Unknown MCP tags must never enter stored Markdown unhandled; BlockNote can
silently remove them on save.

MCP attachment tags contain a source descriptor and a block ID, not a durable
public URL. Conversion flow:

1. Emit a temporary marker containing the block ID and encoded filename.
2. Resolve the block through REST immediately before download.
3. Download the fresh signed URL into clone assets.
4. Replace the marker with a normal Markdown link.
5. On failure, degrade to a readable attachment label, never a raw tag or
   internal marker.

Handle file, PDF, audio, video, and embed tags. Convert modern
`<details><summary>` toggles to Gnosi toggle fences.

The frontend wraps unsupported complete HTML tags in one code span before
parsing so they survive verbatim. Adjacent unknown tags share one code span.
Raw details tags remain allowed because BlockNote normalizes them to toggles.

## Known limitations

- Column content is preserved but flattened because Markdown has no equivalent
  side-by-side layout.
- Signed asset URLs expire and must be downloaded immediately.
- A full workspace clone requires a progress job and many MCP requests.
- Complex Notion OR filters cannot map to Gnosi's AND-only filters and are
  omitted rather than changed semantically.

## Restrictions and repair edge cases

- Do not persist values for properties absent from the effective cloned table
  schema. Doing so creates undeclared, page-specific metadata and leaves
  omitted relation values as raw Notion IDs. Filter row values through the
  effective schema instead.
- Do not prune orphan rows after a truncated, cancelled, or failed clone.
  Unwritten source rows are indistinguishable from real orphans in those
  states. Use the explicit `prune_orphans` repair option only after an
  error-free complete pass; it must soft-delete to `.trash`.
- Do not designate a source-faithful Notion table as the managed LLM Wiki
  Brain while requiring exact schema and row parity. Brain maintenance adds
  managed fields and generated pages. Disable that designation or use a
  separate Brain table before exact reconciliation.
- Do not accept a full-table schema save from a browser snapshot older than
  the current clone revision. A tab left open during reconciliation can
  otherwise restore the pre-clone property list through the schema modal's
  autosave. Exact clones must increment `schema_revision`; schema writes based
  on any other revision fail with HTTP 409 and require a reload.

## QA

1. Pure converter and view-recreation tests use real representative MCP text.
2. Clone one table into a new folder with MCP connected.
3. Verify content, relationships, assets, embedded views, and all tabs in the
   browser.
4. Verify the current vault remains untouched.
5. Expand to the full workspace only after the one-table E2E passes.
6. Untested behavior is not complete.
