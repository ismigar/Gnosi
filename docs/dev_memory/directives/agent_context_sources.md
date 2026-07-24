# Directive: Context sources for Cognition agents

**Status:** Phases 1–3 implemented: files, pages, tables/databases, vaults,
URLs, and searchable external sources.

## Problem

An agent's `context` field was free text that did not even reach the backend.
Users need to attach resources: vault or external files, entire vaults,
databases, pages, URLs, and very large sources such as BOE.

## Guiding principle

**Context is a list of references, not text dumped into the prompt.**

An entire vault or BOE does not fit in a context window. Injecting all of it is
expensive, degrades the answer, and fails as the source grows. Follow the
`vault_tools.py` pattern: put an inventory in the prompt and let the agent read
from bounded sources on demand.

## Data model

An agent has `context_refs`:

```yaml
- id: "ctx-<uuid>"     # stable identifier used by the agent in tool calls
  type: file | page | table | database | vault | url | source
  ref: "<relative path | page_id | table_id | database_id>"
  label: "Readable name"
```

Keep `persona` (instructions) and `context` (free-form notes). Notes still enter
the prompt directly because they are short and always relevant by definition.

## Resolution

`backend/agent/agent_context.py` provides:

- `describe_context_refs(refs)`: a prompt block containing the inventory and
  instructions for reading it.
- `build_context_tools(refs)`: tools closed over the references rather than a
  ContextVar: `list_context_sources`, `read_context_source(source_id)`, and
  `search_context(query)`. Each tool can see only that agent's references.

Resolution by type:

| Type | Initial inventory | On-demand content |
|---|---|---|
| `file` | name and type | text or PDF extraction |
| `page` | title | full Markdown |
| `table` | name, schema, and row count | individual rows and pages |
| `database` | name and contained tables | content through its tables |
| `vault` | top-level tables and databases | content through tables and pages |
| `url` | host | extracted page text, with a 15-minute cache |
| `source` | source name and description | content through its search API |

## Restrictions and edge cases

- **Path containment is mandatory.** `source_id` comes from the LLM, which can
  read untrusted and prompt-injectable pages, email, and PDFs. Tools accept
  only identifiers already present in `context_refs`, never arbitrary paths.
  Follow the same pattern as `vault_tools.read_pdf`.
- **Copy external files into `Assets/` when attaching them.** Absolute paths
  break when OneDrive moves a file and require containment checks on every
  read. The assets endpoint also rejects symlinks outside `Assets/`.
- **Never dump complete tables into the prompt.** Above
  `MAX_INVENTORY_ROWS`, include only the schema and row count. Use
  `search_context` for the rest.
- **Invalidate the agent cache after saving configuration.**
  `app.state.agent_cache` stores the graph by agent, and tools retain
  references in their closure. Without invalidation, the agent continues with
  stale context.

## Phase 2 — URLs (`backend/agent/web_context.py`)

- **SSRF protection is mandatory.** The backend can reach hosts hidden from
  the user's browser, including loopback, private `10/172/192.168` networks,
  and link-local `169.254` cloud metadata. `is_public_http_url` resolves the
  hostname and validates the resulting address, not just the input string. A
  public hostname can resolve to `127.0.0.1`.
- **Web content is untrusted input.** Always wrap it with `wrap_untrusted()`,
  explicit delimiters, and the statement that it is data rather than
  instructions.
- Extract with Trafilatura using `output_format="txt"`, falling back to
  BeautifulSoup when Trafilatura returns boilerplate. Cache each URL for
  15 minutes.

## Phase 3 — large searchable sources

Adapters under `backend/agent/context_sources/` query sources rather than
scraping them. Each adapter exposes `ID/LABEL/DESCRIPTION`, `search(query)`,
and `read(reference)`, and registers in `CATALOG`. The configuration selector
loads the catalog from `GET /api/agent/context-sources`.

BOE support in `boe.py` uses `boe.es/datosabiertos`:

- Search with
  `GET /api/legislacion-consolidada?query=<json>&limit=N`. Its DSL resembles
  Elasticsearch:
  `{"query":{"query_string":{"query":"texto:x and texto:y"}}}`. Join terms
  with `and`; `or` matches too much of BOE.
- `read("BOE-A-…")` returns a block index,
  `read("BOE-A-…#block")` returns block text, and `read("YYYYMMDD")` returns
  the daily summary.
- `/texto/bloque/{id}` supports XML only. With
  `Accept: application/json`, it returns HTTP 400 with a Spanish unsupported
  MIME-type message. Other endpoints return JSON.
- XML responses wrap content with `<status>200 ok</status>`. Read only the
  `<data>` node or each article receives a spurious `200 ok` prefix.
- BOE often returns HTTP 200 even for application errors. Inspect
  `status.code`, not only the HTTP status.

## QA with a real BOE-backed agent (2026-07-21)

The pipeline works; model behavior was the weak point. The following defects
were found and fixed:

1. **`factory.py` captured `cfg` at import time.** An agent created from
   Settings remained invisible until process restart and produced
   "No LLM provider available." `create_agent_workflow` now reloads
   `load_params()`, as `get_default_llm_with_meta` already did.
2. **The `general` node invented tool calls.** The supervisor sent it the
   question even though it had no tools, so the model narrated a
   `search_context` call and fabricated a result, including a repealed law.
   Agents with attached sources now route to `Brain`, and `general` explicitly
   knows it has no tools. Place this rule before the base prompt; the final
   worker-name-only format instruction must remain last or the graph ends
   without a selected worker.
3. **`brain` could not see the inventory.** Only `supervisor` and `general`
   received it through the persona, so Brain invented BOE identifiers that
   returned 404. `brain_system` now includes `describe_context_refs`.
4. **Catalan queries returned no BOE results.** BOE content is Spanish and all
   terms were joined with AND. The implementation removes Catalan and Spanish
   stopwords, tries AND first, retries with OR when empty, and advises users to
   search in Spanish when no results remain.
5. **Prompts must not show call syntax.** Writing
   `read_external_source(source_id, ref)` encourages some models to emit
   `<function=read_external_source{...}>` as text. Mention bare tool names
   only.

## Open limitation

`llama-3.3-70b-versatile` on Groq frequently returns `tool_use_failed` by
emitting a call as text when Brain has its full tool belt (14 native tools plus
MCP tools). This is not a tool implementation defect: `search_context` and
`read_external_source` work both directly and in a real chat turn. Agents with
attached sources currently require a model with reliable native tool support.
Failures now appear as readable messages instead of `Internal error [id]`.
