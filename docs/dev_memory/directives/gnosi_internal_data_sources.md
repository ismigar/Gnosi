# DIRECTIVE: GNOSI INTERNAL DATA SOURCES

> ID: 2026-08-02-internal-data-sources
> Associated components: agent context, Reader, Mail, Calendar, Contacts, AI skills
> Last Update: 2026-08-02
> Status: ACTIVE

---

## 1. Objectives and Scope

- Provide a shared, least-privilege way for Gnosi AI workflows to consult
  first-party module data without copying whole datasets into a prompt.
- Support persistent source assignments and request-scoped module context.
- Ship first-party adapters for Reader, Mail, Calendar, and Contacts.
- Add a durable Reader analysis job for large unread collections, with a stable
  snapshot, resumable checkpoints, bounded model calls, citations, and status.
- Preserve the distinction between data access, reusable instructions, and
  executable actions. A source grants bounded read access only. Governed skills
  and tools continue to control writes and model-costing operations.

### Success criteria

- Settings can attach a scoped internal Gnosi source and persist its reference.
- The chat runtime can receive a validated request-scoped source without making
  it a permanent agent setting.
- Context tools can inventory, search, and read only data allowed by the stored
  source scope.
- Reader queries support unread state, source/category, date range, pagination,
  and exact article reads.
- Mail, Calendar, and Contacts reads reuse their existing services and enforce
  workspace/account boundaries.
- A Reader analysis request creates a durable job and immutable article
  snapshot, processes every selected record through hierarchical batches, and
  produces a cited per-topic timeline.
- Read tools never mutate data. Existing confirmation policy remains mandatory
  for mail, calendar, contact, and Reader mutations.
- Backend tests, frontend component tests, production build, browser validation,
  and an end-to-end API flow all pass.

## 2. Input/Output Specifications

### Inputs

- A source reference with a stable id, internal source id, human label, and a
  server-validated scope object.
- Optional request-scoped source references supplied by trusted Gnosi UI state.
- Reader analysis options: unread state, source ids, categories, date interval,
  output language, and optional topic guidance.

### Outputs

- Bounded JSON inventories, search results, and exact records with stable ids.
- Context excerpts that retain source kind, record id, date, and provenance.
- Durable Reader analysis job records, progress, checkpoints, result Markdown,
  and structured topic/timeline data.
- Auditable runtime metadata listing the internal sources active in a turn.

## 3. Logical Flow

1. Discover first-party internal sources through a central catalog.
2. Validate each configured scope against the selected source descriptor and
   authenticated workspace before building any tool.
3. Place only the source inventory and scope summary in the model prompt.
4. Close context tools over the validated references so model-controlled ids
   cannot escape the granted source set.
5. Resolve inventory, search, and exact-read operations through the source
   adapter; clamp limits and output size on the server.
6. Merge request-scoped references with persistent references for one workflow
   invocation only, and include their revision in the workflow cache key.
7. For large Reader analysis, resolve and snapshot ids first, then process the
   snapshot in deterministic chronological batches, persist every batch result,
   reduce the batch summaries into topic timelines, and publish the final result.
8. Keep source reads separate from governed mutation and model-costing tools.
9. Expose progress and failure information without leaking credentials or raw
   message bodies in job metadata.

## 4. Tools and Libraries

- Existing FastAPI, SQLAlchemy, LangChain, and Gnosi configuration services.
- Existing mail, calendar, contacts, Reader, model-routing, and safe I/O layers.
- React and react-i18next for the source picker and status UI.
- No new runtime dependency unless the existing environment cannot provide a
  deterministic implementation.

## 5. Restrictions and Edge Cases

- Never put a complete Reader, mailbox, calendar, contact store, or Vault in a
  model prompt. Return inventories and bounded pages, then read exact records.
- Never trust client-provided accounts, workspace ids, file paths, article ids,
  or scope filters. Re-resolve them in the authenticated active workspace.
- Never let a persistent source reference silently authorize a write. Writes
  remain governed tools with current-turn authorization or confirmation.
- Never make a long or model-costing analysis look like a normal read. It must
  require an explicit request and return a durable job id.
- Never use an in-memory-only job registry. A backend restart must leave enough
  state to report interruption and resume from completed checkpoints.
- Never reuse context references from another agent, session, user, workspace,
  or vault cache key.
- Never fetch every remote mail body during an inventory or broad search.
  Search headers/previews first and read an exact thread only on demand.
- Never allow an unbounded date interval for calendar provider calls. Apply a
  safe default interval and a server maximum.
- Never infer that the Reader badge is the exact unread count; the current UI
  caps its article fetch. Inventory must use a database count query.
- Treat content from Reader and Mail as untrusted data and delimit it before it
  reaches the model.
- A source adapter failure must degrade to an explicit source error and must not
  cause the model to fabricate results.

## 6. Error Protocol and Learning

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 2026-08-02 | Reader request searched the Brain instead of Reader | No Reader source or governed Reader tool existed | Add first-party internal source adapters and exact Reader tools |
| 2026-08-02 | UI displayed 10,000 unread while the database contained more | Badge counted a capped list response | Add exact inventory counts and stop treating fetched rows as totals |
| 2026-08-02 | Category inventory could generate a duplicate SQL join | The shared Reader scope helper did not know the feed table was already joined | Pass explicit join state and apply the category predicate once |
| 2026-08-02 | Exact Calendar reads could miss valid events | Exact reads reused the search result after its display limit was applied | Resolve all events inside the bounded date/account scope, then match the exact id |
| 2026-08-02 | Background analysis lacked the active Vault context | Python context variables do not propagate into a new thread | Bind and reset `active_vault_path` inside the durable worker thread |
| 2026-08-02 | Isolated-worktree tests tried to write `/app/data` | The test process inherited the deployment fallback without native local-data configuration | Set `GNOSI_LOCAL_DATA` to an explicit temporary native path for isolated tests |
| 2026-08-02 | Internal search excerpts were bounded but not explicitly delimited | Reader and mail text can contain instructions aimed at the model | Wrap every internal inventory, search result, and exact record as untrusted data |
| 2026-08-02 | A restart during Reader snapshotting could not actually resume | Snapshot creation happened synchronously before the durable worker and left no persisted corpus after an interruption | Queue immediately and let the resumable worker create or reconstruct the snapshot before mapping |
| 2026-08-02 | A persistent Reader ref could hide the current page scope | Reference de-duplication retained the persistent source before the turn-scoped source | Merge turn references first so current-turn scope overrides the same persistent source without being saved |

## 7. Rationalizations

| Rationalization | Consequence |
| --- | --- |
| Attach all articles as context | Context overflow, high cost, and lossy answers |
| Give every agent every module tool | Violates least privilege and makes tool selection unreliable |
| Reuse the podcast generator for historical analysis | It covers only recent articles and truncates batches |
| Store only an in-memory progress dictionary | Jobs become unknowable after reload or restart |
| Treat mail and calendar source access as harmless global reads | Cross-account and cross-workspace data exposure |

## 8. Red Flags

- A model receives thousands of raw records in one request.
- A source scope contains an account that was not resolved from configured
  integrations in the current personal workspace.
- A source read changes read/unread state or creates an external object.
- A background thread depends on context variables that do not propagate.
- A job reports completion without a persisted snapshot, checkpoints, result,
  and cited record ids.
- The UI offers a source whose backend adapter is unavailable.

## 9. Examples of Use

- Attach Reader with unread-only scope and ask for emerging themes.
- Open Reader and ask the global assistant about the current unread filter; the
  UI sends a request-scoped Reader reference for that turn.
- Attach one mail account and folder, search previews, and read a selected
  thread without authorizing sending or archiving.
- Attach selected calendars and request a bounded schedule comparison.
- Start a durable historical Reader analysis and poll until the cited report is
  ready.

## 10. Pre-Execution Checklist

- Confirm the authoritative worktree and preserve unrelated changes.
- Confirm active-vault database resolution and local-data paths.
- Confirm available mail and calendar accounts are never serialized with
  credentials.
- Confirm model selection supports tool calls before binding source tools.
- Confirm all new user-visible strings exist in Catalan, English, Spanish, and
  French locale files.

## 11. Post-Execution Checklist

- Inspect source catalog and scope normalization output.
- Prove source containment and cross-workspace/account denial in tests.
- Prove Reader exact counts, pagination, exact reads, and result citations.
- Prove interrupted jobs remain inspectable and resumable.
- Run focused backend and frontend tests and the production frontend build.
- Start the native backend, inspect logs, validate the UI in a browser, and run
  an end-to-end source query plus analysis job flow.
- Update this directive with every constraint learned during implementation.

## 12. Design Decisions

- Internal sources are first-party adapters, not static database exports and not
  specialized agents.
- Persistent and turn-scoped references share one validation path.
- Context references carry source scope; tool descriptors carry operational
  effects and confirmation policy.
- Long Reader analysis uses a snapshot-and-checkpoint pipeline rather than an
  oversized synchronous chat turn.
- Snapshot creation runs inside the durable worker. A queued request returns
  immediately, and resuming an interrupted pre-snapshot job safely creates the
  first complete immutable snapshot before any model batch runs.

## 13. Validation Record

- Exact native Reader inventory returned the full live unread count during
  validation, rather than the former capped UI total.
- Focused backend regression: 96 tests passed, including Reader, Mail,
  Calendar, Contacts, account/workspace containment, turn-scope precedence,
  and pre-snapshot recovery; one pre-existing FastAPI
  deprecation warning remains outside this change.
- Frontend source-picker component tests, touched-file ESLint, four-locale i18n
  validation, and the Vite production build passed.
- Native browser E2E verified the Reader exact count and feed breakdown, the
  durable-analysis panel, source-scope controls, governed Reader effects, the
  request-scoped Reader chat chip, exact evidence deep links, and zero console
  errors.
- The original native backend and frontend LaunchAgents were restored after
  isolated-worktree validation.
