# Agent behavior resources

Application methodology is distributed under `backend/agent/behavior`. The operation catalog loads these resources, and caller functions serialize task identifiers and data. `catalog.json` maps the thirteen operation families. `call-sites.json` inventories entrypoints in backend, pipeline and extensions; regenerate it with `python scripts/inventory_agent_calls.py`.

## Responsibilities

- Profile `persona`: role, style and general quality criteria.
- Effective skill: reusable procedure, variants and acceptance criteria.
- Profile context, selected reviewed memory and source references: data, never permissions.
- `AgentOperation`: structured data, explicit options, references and output contract.
- Executor and tools: authorization, current plugin availability, budgets, cancellation, validation and persistence.

Assigned personal skills derived from a canonical skill replace its methodology. Canonical identity, plugin dependencies and tool grants remain those of the original. Conflicting personal replacements fail explicitly. The source revision and original are retained in the existing skill provenance. Profile migration preserves previous text and context, seeds empty instructions once, and retains the bundled original for restoration.

`ai.operation_bindings` records canonical operation → bot/skill bindings. The Operations view displays and changes the executor through a revision-aware configuration API. Assignment validates the selected bot and its skills. Existing jobs retain frozen bindings. The original baseline and newly available bundled instructions remain separately inspectable.

## Execution and document reading

Snapshots freeze profiles, procedures, selected memory and system resources. Operation requests retain their public response contracts. Delegated operations select their specialist profile and preserve parent lineage and the granted skill boundary.

New source-reading runs use validated JSON actions for indexing, reading, searching, working notes and final submission. The model chooses the intellectual sequence. Knowledge notes additionally pass existing coverage, quote and persistence validation. Notebook, Reader and podcast synthesis share the read-only document action executor. Complete originals are supplied together when the measured budget permits; larger sources use stable parts with offsets. Original quotations are checked before final submission. Delivery coverage is not a claim of comprehension.

Private work checkpoints are separate from trace retention. A bounded action allowance leaves the work state available for another attempt. Existing snapshots without behavior resources use their compatibility paths.

Chat models without native tool calls use a validated JSON transport. Tool definitions, actual transported messages and responses appear in the trace. Unknown tools, invalid arguments or unsupported response formats fail explicitly. The same tool authorization boundary applies to both transports.

## Inspection and traces

`POST /api/agent/runs/preview` resolves saved/draft profile composition without a model call. It lists effective skill versions, canonical operations and system resources. The run trace is the authoritative record of actual model messages and tool activity.

Trace endpoints provide cursor pagination, JSON export, deletion and scoped retention settings. The default is 30 days after closure. Active runs and private work checkpoints are retained. Content is stored by digest, with shared immutable text blocks. Authorization keys, known bearer/API-key patterns and structured credentials are masked; the trace identifies redacted paths. External engines expose only the request/result available to Gnosi.

Maintenance enforces retention every ten minutes while the backend is running, including scopes whose history is never opened. History reads also enforce expiry. Resuming an expired execution starts a new trace segment and records the missing earlier segment; it does not reconstruct deleted events.

Token accounting reuses an available model tokenizer; otherwise it explicitly records a conservative UTF-8 upper bound. It never silently truncates a document to meet a model limit.

## Validation

Behavior and document tests use synthetic sources and model doubles. Packaging has an explicit resource allowlist. Backend boundary checks reject ungoverned provider access. Frontend composition/history controls reuse existing settings components and include Catalan, Spanish, English and French labels.

### Verification boundaries

Regression checks use an isolated temporary data directory and synthetic model responses. They cover behavior replacement, frozen execution state, JSON tool validation, complete-source reading, unreadable sources, resumption, trace isolation/expiry, bot binding conflicts and settings views. OpenAPI and generated client checks verify the public contracts; the desktop resource-policy check verifies inclusion of the behavior files.

This source change has not been deployed into the installed desktop application. Live-provider behavior, a built desktop bundle and visual checks across every supported theme still require an application-level validation run.
