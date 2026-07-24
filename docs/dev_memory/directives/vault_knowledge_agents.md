# Knowledge Agents for the Vault

## Objective

Extend Gnosi's existing AI agent system so agents can safely act on vault
knowledge, not merely search it. Target workflows include link suggestions,
PDF summaries and Cornell notes, vault curation, grounded chat, and external
research captured as a note.

## Existing foundation

Gnosi already provides:

- Supervisor, coder, brain, and general-agent routing.
- Multi-provider LLM calls.
- MCP tools.
- Generated-tool validation and sandboxing.
- Vector memory.
- SSE chat with tool-call events.
- Markdown agent instructions.
- Read-only vault search and registry tools.

The missing layer is a generic set of knowledge-writing tools. Extend the
existing brain agent; do not create a parallel agent framework.

## Knowledge tool belt

Add `backend/agent/vault_tools.py` with reusable tools:

- `read_page`
- `read_pdf`
- `create_page`
- `update_page`
- `get_relations`
- `link_pages`
- `query_table`
- `list_tables`
- `propose_links`

Wrap existing vault services rather than reimplementing route logic. Every
write must preserve authorship, atomic persistence, folders, aliases, and
index updates.

Register these tools with the brain agent, not the coder.

## Safety rules

- Vault writes are local writes under the existing risk model.
- External MCP writes remain external actions.
- Never test write tools against real notes; use a temporary vault or
  disposable pages.
- Never write derived, read-only, formula, rollup, or authorship audit fields.
- Destructive actions require an accessible UI confirmation and must not be
  hidden inside an agent tool.
- Reads of PDFs and assets must respect containment and provider
  materialization.
- Tools return explicit changed targets so the user can audit the result.

## Knowledge personas

Personas are Markdown instructions orchestrating the same tool belt:

- Curator: find orphaned or duplicate records, suggest tags, and fill gaps.
- Connector: propose links for the active page.
- Summarizer: create summaries or Cornell notes from a page or PDF.
- Grounded chat: answer from vault search with citations.
- Researcher: combine external MCP research with a new vault note.

Inject `active_page_id` and active table context into `/api/chat` so personas
can operate on the user's current scope without guessing.

## Data-driven model router

Replace hard-coded model stacks with a configurable registry:

```text
provider, model_id, endpoint, is_local, enabled, priority,
input/output cost, context window, capability tags, monthly quota
```

Routing policy:

1. Filter by required capabilities such as tools, code, vision, or long
   context.
2. Exclude unavailable or unhealthy providers.
3. Respect quota and estimated-cost ceilings.
4. Prefer cheaper or local models when budget is constrained.
5. Rank remaining candidates by expected quality for task complexity.

Keep chat modes `auto`, `manual`, and `agent_default`. Manual selection forces
an enabled registry entry.

Persist usage accounting under local data, grouped by provider and billing
period. Local models have zero monetary cost. Monthly quota counters reset
deterministically.

## External connections through MCP

Expose a settings-managed MCP server registry covering stdio, HTTP, and OAuth.
Reuse `backend/mcp/client.py`.

This can provide exact Notion views through the hosted Notion MCP connector and
support future web research without new core architecture.

## Extensibility requirements

- Generated tools remain sandboxed and validated.
- Any future external service should be addable through MCP.
- Personas remain data-driven Markdown resources.
- Vault tools remain generic read, write, relate, and query primitives rather
  than one-off workflow implementations.

## QA

1. Unit and integration tests use a temporary vault and isolated local data.
2. Chat E2E requests a Cornell summary and link suggestions.
3. Verify `tool_start` and `tool_end` events.
4. Refetch the created page and relation to prove persistence.
5. Remove disposable QA data through the normal confirmed workflow.
6. “Could not test” is not completion.

## Implementation order

1. Generic vault tool belt.
2. Connector and summarizer demonstration personas.
3. Remaining knowledge personas.
4. Data-driven model routing and usage accounting.
5. External MCP registry and research workflows.
