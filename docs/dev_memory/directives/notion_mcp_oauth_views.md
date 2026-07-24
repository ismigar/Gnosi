# Faithful Notion Views through MCP OAuth

## Objective

Recreate linked Notion database views as Gnosi embedded views. The public
Notion REST API cannot provide the required view target and configuration.

## Why MCP is required

REST exposes linked database blocks as untitled child databases and may reject
their IDs because the integration has no accessible data source. It therefore
cannot reliably identify the target table, filters, or layout.

The hosted Notion MCP service returns enriched content containing resolvable
inline database references. This is the only verified source for high-fidelity
view recreation.

## Architecture

```text
backend/mcp/http_client.py
backend/api/notion_oauth_routes.py
backend/services/notion_mcp.py
backend/services/notion_view_recreator.py
```

- OAuth uses authorization code flow and stores the access token under
  `notion_mcp` in local integration secrets.
- Application client credentials come from environment configuration.
- The MCP client supports streamable HTTP/SSE and Bearer authorization.
- The shared client is reusable by both the importer and knowledge agents.

## View recreation

For each imported page:

1. Fetch enriched page content through MCP.
2. Parse every inline database reference with its surrounding section.
3. Map the source database ID to the imported vault table.
4. Create a deterministic, idempotent Gnosi view.
5. When possible, infer the relation back to the host page and apply a
   `{field, value: "this"}` filter.
6. Replace the untitled child reference with a Gnosi view embed in the correct
   section.

The exact multi-tab behavior and attachment handling are specified in
`notion_exact_clone.md`.

## Import integration

`POST /api/notion/import` accepts `recreate_views`. When enabled with a valid
MCP token, the importer enriches pages after the REST data pass. Without MCP,
it completes the REST import without views and reports the fidelity limitation
without failing the entire job.

## Limitations

- Some exact Notion filters may remain unavailable or unmappable.
- Complex OR and status-group filters must be omitted rather than altered.
- Endpoint, scopes, transport details, quota, and rate limits must be checked
  against current official Notion documentation during implementation.
- User content and source view names are data and are not translated.

## QA

1. Pure tests parse representative MCP inline-database markup and build
   deterministic views.
2. OAuth tests cover state, token storage, refresh/failure behavior, and secret
   redaction.
3. Live E2E imports a page with linked views and verifies rendered data in the
   browser.
4. Fallback without MCP completes safely and reports missing view fidelity.
5. Untested behavior is not complete.

## Implementation order

1. Shared MCP HTTP client and Notion OAuth.
2. Page fetch and view parsing.
3. View recreation and importer flag.
4. Optional bulk enrichment for previously imported pages.
