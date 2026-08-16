# Directive: Agent Response Performance and Deterministic Synthesis

**Status:** Universal request contract and seven-part quality contract implemented and verified; claim grounding, bounded job recovery, and privacy-safe evaluation feedback are the active extension contract.
**Origin:** 2026-08-14.

## Purpose

Keep agent turns responsive without weakening tool governance or discarding the
conversation record. The checkpoint remains the canonical audit history, while every
provider request receives only the bounded evidence required for the current turn.

## Context policy

- Always preserve the latest user message. Retain only complete assistant/tool protocol
  groups from that turn, prioritizing the newest evidence when the aggregate cap cannot
  hold every result.
- Preserve earlier user and final assistant messages as conversational memory, but omit
  historical tool-call groups and raw tool results from provider prompts.
- Apply a hard aggregate model-message ceiling even when a model advertises a very large
  context window. Tool schemas, system instructions, and reserved output remain separate
  parts of the provider budget.
- Never mutate or delete checkpoint history merely to reduce provider input. Prompt
  compaction is a read-time projection.

## Deterministic response policy

- A server-owned deterministic intent may return a server-formatted assistant message
  after its governed read tool succeeds. It must not invoke a model merely to restate an
  exact count and bounded record list.
- Deterministic formatting must use only the tool payload, escape record labels as
  untrusted text, preserve count and pagination facts, and expose tool errors as explicit
  limitations.
- Requests that require interpretation, comparison, summarization, or generation continue
  through model synthesis.

## Universal request contract

Every turn is classified server-side into one of five provider-independent modes before
the model is allowed to choose tools:

- `conversation`: no source read or governed operation is required.
- `lookup`: retrieve bounded evidence for a factual question and let the model synthesize.
- `inventory`: enumerate or count exact matching records with deterministic pagination,
  grouping, provenance, and no model call after the governed read.
- `analysis`: retrieve bounded evidence or start an explicitly requested durable collection
  analysis, then let the model interpret the evidence.
- `action`: expose only the explicitly authorized governed operations for the turn.

A default attached Vault must not capture an explicit mail, calendar, contacts, Reader,
weather, web, Notion, or Zotero request. When such a domain is explicit and no Vault object
is named, Vault tools are removed from the model-visible turn surface. Conversational turns
likewise bind no passive tools and perform no automatic source read.

The classifier uses multilingual request semantics rather than topic-specific rules. Topic
terms such as “coaching” are query data, never routing rules. Requested record types are
resolved against the attached Vault registry at execution time so new tables work without
adding code aliases; common localized words such as sources, notes, articles, tasks, and
projects are only compatibility hints.

An attached Vault inventory query must return structured JSON containing the normalized
query, exact matching count, type counts, offset, limit, `has_more`, `next_offset`, and
canonical record identifiers. It searches every authorized attached table or active view,
deduplicates by canonical record id, applies explicit type filters, and exposes selected
canonical metadata such as year, item type, verification status, and path when available.
The deterministic renderer must group records by type, say when a page is partial, and
preserve identifiers needed for a later exact read.

## Seven-part quality contract

Every chat turn produces one server-owned, provider-independent plan before the graph
runs. The plan is request-scoped state and must overwrite any checkpoint value from an
earlier turn. It contains only bounded operational metadata, never hidden reasoning or
source bodies.

The quality contract has seven required parts:

- Continuous evaluations exercise multilingual routing, capability selection, privacy,
  asynchronous admission, verification requirements, and safe explanations without
  spending provider tokens. The same deterministic suite runs on pull requests and on a
  schedule, and fails closed when a required score regresses.
- The universal capability planner resolves the operation mode, explicit data domains,
  relevant governed tools, required evidence, execution mode, and output strategy from
  the current request plus live runtime descriptors. The graph uses the plan to narrow
  its real tool surface; the plan is not decorative telemetry.
- The response verifier checks the final answer against current-turn tool evidence. It
  blocks unsupported claims of completed actions, rejects source-dependent answers that
  skipped required evidence, records tool limitations, and attaches a bounded verification
  report to the message. It never asks another model to judge the first model.
- Long collection analysis uses the provider-neutral durable-job facade. When an attached
  source exposes a durable analysis operation, the planner chooses background execution,
  the server starts it deterministically, and the message exposes its namespaced job id,
  progress capability, result availability, resumption, and cancellation capability.
  Unsupported sources remain foreground and are never presented as durable jobs.
- Index-backed answers expose freshness status, build age, cache coverage, direct-read
  fallback count, and whether a non-blocking refresh was scheduled. A stale index may be
  used under stale-while-revalidate only when that limitation is visible; it must never be
  described as freshly rebuilt.
- Privacy is calculated per request from attached sources, selected provider locality,
  requested domains, and tool effects. The runtime sends only required evidence, withholds
  unrelated sources and tools, and never grants data-egress or consequential effects from
  an earlier turn. The UI reports whether private evidence may be processed by a remote
  model without exposing the evidence itself.
- Useful explainability reports the operation mode, selected route, background/foreground
  execution, tools actually used, evidence count, freshness, privacy posture, and verifier
  result. Do not expose chain-of-thought, prompts, credentials, raw tool payloads, or hidden
  policy text.

The chat stream emits plan metadata before execution and attaches the final verification,
freshness, job, and explanation metadata to the assistant message. These fields are
presentation metadata: they survive local chat persistence but do not become historical
provider prompt content.

Exact inventories reuse the persisted parsed-document cache and link index. Relation-aware
queries expand canonical links to indexed titles, while requests that explicitly ask what
records contain or mention a term disable relation expansion. A missing cache entry may fall
back to a direct governed read, but normal warm requests must not reopen every Vault file.

## Claim-level citation contract

- Every source-dependent final response carries a bounded `gnosi_citations` object generated
  by the server from current-turn tool results. It contains a citation status, safe source
  descriptors, claim-to-source mappings, and explicit limitations; it never contains source
  bodies, excerpts, filesystem paths, prompts, or hidden reasoning.
- Canonical Vault records link by record id, Reader articles link by article id or an approved
  HTTP(S) URL, and aggregate count/method claims cite the exact governed tool-result manifest.
  A source id is valid only if it appeared in a successful current-turn tool payload.
- Deterministic inventory responses map every listed record line to its canonical record and
  map count, grouping, pagination, and method claims to the inventory manifest without model
  participation.
- Model-synthesized answers use `[[cite:SOURCE_ID]]` markers. The server removes valid markers
  from visible prose, rejects invented ids, maps each marked claim to its validated sources,
  and marks required grounding as partial when factual source claims remain uncited.
- The client renders claim/source associations and safe links as presentation metadata. Citation
  metadata survives local transcript persistence but is excluded from future provider prompts.

## Bounded automatic job recovery

- Provider-owned durable jobs may advertise a persisted retry policy: automatic/manual mode,
  current attempt, maximum attempts, base and maximum delay, next retry time, model-call budget,
  calls used, last retry reason, and budget exhaustion.
- Retry only failures classified as transient (timeouts, temporary connectivity/service
  unavailability, or rate limiting). Use exponential backoff capped by the declared policy.
  Permanent validation, authorization, containment, cancellation, and malformed-result failures
  finish immediately and remain visible.
- A retry-wait job is cancellable. In-process timers launch due work; status/list reconciliation
  launches an overdue persisted retry after a backend restart. Checkpoints remain authoritative,
  so completed batches are never repeated unnecessarily.
- The owning provider enforces the model-call budget immediately before every model call. Automatic
  and manual resume share the same persisted attempt and cost boundary; neither can create an
  unbounded loop. The provider-neutral facade only normalizes the public contract.

## Privacy-safe quality feedback and evaluation candidates

- Agent stream errors are recorded automatically, and assistant thumbs feedback is sent to a
  first-party authenticated endpoint. Records are local-instance telemetry scoped to vault,
  workspace, and user.
- Telemetry stores operational metadata only: hashed turn/session/agent identities, stable error
  code, bounded plan fields, verifier status/limitations, tool names, and timing buckets. It must
  not store prompts, responses, record titles, source names, source ids, paths, URLs, excerpts,
  attachments, or raw tool payloads.
- A negative rating or stream error deterministically upserts a deduplicated evaluation candidate
  keyed by its structural failure signature. Each candidate contains a synthetic non-private
  reproduction message, expected planner invariants, occurrence counts, and a review state.
- Candidates are never added silently to the public CI corpus. An administrator reviews and
  accepts or rejects them; accepted cases remain runnable in the local candidate suite and may
  later be copied deliberately into the versioned universal corpus.
- Repeated feedback for the same turn is idempotent. Clearing or changing a rating rebuilds the
  derived candidate counts rather than appending duplicate observations.

## Turn tool selection

- The ToolNode retains the complete active-skill runtime so server-authored calls and
  policy enforcement remain valid.
- Each model invocation binds only read-only tools plus guarded tools explicitly authorized
  for the current turn.
- Legacy automatic profiles narrow passive reads to the request's multilingual domain
  terms, exact required context operations, and a bounded maximum. Explicitly scoped
  non-legacy skills retain their already-small assigned read surface.
- Mandatory attached-context reads bind only the exact required context tool on their first
  step. A deterministic response binds no tools during final synthesis.
- Tool reduction must never broaden authority, hide an explicitly authorized tool, or be
  cached from one turn into another.

## Timing telemetry

Every completed chat stream reports bounded server timings for setup, routing,
model execution, tool execution, other graph work, and total elapsed time, plus provider
input and output token counts. The client stores these values with the assistant message
and displays them in message details. These measurements are diagnostic and never form an
authorization or billing boundary.

## Verification

- Historical raw tool payloads are absent from a later provider prompt while current-turn
  tool protocol remains valid.
- The self-authored Resources request performs exactly one governed read and no model call
  after the result.
- Read-only turns do not bind unrelated write, destructive, or model-costing tools.
- Representative routing tests cover Vault tables, Vault pages, Reader inventory/search,
  durable Reader analysis, Brain processing status, and repeated-call termination.
- A multilingual request matrix proves that inventories, lookups, analyses, actions, and
  conversation remain distinct independently of the requested topic or attached table name.
- Backend tests, frontend tests and build, native browser validation, a real end-to-end chat
  turn, and the documentation gate all pass before publication.
- The continuous evaluation corpus covers all five operation modes, at least the four UI
  languages, unrelated-domain containment, explicit actions, attached private sources,
  remote and local providers, durable analysis admission, stale index reporting, and
  unsupported-completion blocking.
- A browser test opens message details and confirms that planning, privacy, evidence,
  freshness, job status when present, verification, and timing are understandable without
  exposing source text or hidden reasoning.
- The 2026-08-14 native verification covered 316 backend tests and a successful production
  frontend build. A real relation-aware “coaching” inventory returned 64 records (36 direct
  matches and 28 relation matches) with one tool call, no model call, and between 1.156 and
  2.343 seconds of server time in the recorded warm runs. A browser turn requesting the live
  `Titulaciones` table returned all 11 records, displayed the undo control, and completed in
  one visible second without console errors; a later API run of the alternative “Mostra’m”
  phrasing completed in 1.784 seconds.
- The seven-part quality-contract verification then covered 312 affected backend tests,
  12 focused frontend tests, all four locale catalogs, a production build, and all 16
  provider-free continuous evaluation cases. A real “coaching” inventory returned the same
  64 records with 100% index coverage, one local tool, no model call, no private evidence
  sent to the configured remote model, and 0.727–0.974 seconds of server time. Browser
  message details exposed the effective plan, 64 evidence items, local privacy posture,
  passed verification, fresh index state, and exact phase timings without console errors.
  The provider-neutral jobs API also reconciled an existing failed Reader job and exposed
  its namespaced id, 12% checkpoint progress, result unavailability, and resume capability.
- The 2026-08-15 universal-agent hardening passed the complete backend suite (1,873 passed,
  27 skipped), all frontend tests (296 passed), the 16-case provider-free evaluation corpus,
  the production frontend build, and the focused retry, citation, telemetry, and planning
  tests. A native browser turn for the exhaustive self-authored Resources inventory returned
  55 records in one visible second, exposed 56 claim-to-source bindings with 55 canonical
  Vault links and no unsafe link, persisted and cleared negative feedback, and produced no
  browser console warning or error.
- The 2026-08-16 inventory regression suite passed 99 tests. A request for notes about how
  to find quality bibliographic sources now normalizes multilingual request scaffolding and
  applies a bounded, transparent bibliographic-concept vocabulary; it can therefore match
  a canonical title such as “Cerca i recuperació d'informació” without a model-generated
  synonym or an invented result.

## Restrictions and edge cases

- Do not summarize historical tool results with another model call; it recreates the
  latency and cost being removed.
- Do not truncate a tool-call group into an invalid provider protocol. Keep a complete
  current-turn call/result group or omit the whole historical group.
- Do not bind every assigned tool because a model has a large context window. Large schema
  sets slow selection and increase incorrect calls.
- Do not use broad action verbs such as “search” to activate an unrelated domain. Apply
  generic search matching only when the request contains no mail, calendar, table, Vault,
  Reader, file, task, contact, or web domain signal.
- Do not classify a registered tool as connected to an external account. Catalog
  availability proves only that the runtime adapter exists.
- Do not discard read-only metadata when wrapping legacy MCP tools. Dynamic binding relies
  on explicit effect metadata to distinguish passive reads from consequential actions.
- Do not name a non-plural i18n key with an `_other` suffix. The locale validator treats
  that suffix as a plural form; use a neutral name such as `timing_misc` instead.
- Do not treat client wall-clock time as a phase breakdown. Server phase metrics and client
  total elapsed time answer different diagnostic questions.
- Do not use bounded semantic search to answer “all”, “which”, “how many”, or equivalent
  inventory questions. A top-k result is evidence discovery, not an exhaustive inventory.
- Do not treat every inventory query as literal token equality. For reviewed concepts such
  as bibliographic source discovery, use the bounded server-owned expansion vocabulary and
  expose the applied terms in the tool payload; never silently substitute an open-ended
  embedding search or a model-authored synonym.
- Do not add a hard-coded intent branch for each topic. Classify the operation and pass the
  remaining subject terms to the generic inventory or lookup implementation.
- Do not infer an exact record type from a loose topic word when no attached registry table
  matches it. Search all authorized attached types and report their actual type names.
- Do not silently present the first page as complete. Exact counts and pagination status are
  part of the response contract.
- Do not force the default Vault merely because it is attached. Explicit non-Vault domains
  use their own assigned skills and tools unless the request also names Vault content.
- Do not build a second asynchronous storage system inside chat. Register source-owned
  durable operations behind the capability-job facade and preserve their authoritative
  containment checks.
- Do not treat a provider's `state` field as different from the public job `status`, expose
  a result before `result_available`, or omit provider-supported resume after a failed or
  interrupted job. Normalize these fields at the UI boundary.
- Do not display a plan without enforcing it on the bound tool set. Explanations must
  describe the effective runtime decision, not a parallel advisory classifier.
- Do not verify an answer with another language model. Deterministic evidence and effect
  checks are the authorization and truth boundary.
- Do not label an old persisted index as fresh merely because every requested id exists in
  it. Report age and stale-while-revalidate state separately from coverage.
- Do not accept a model-authored citation id that is absent from successful current-turn tool
  evidence. Remove the marker, report the limitation, and never manufacture a link.
- Do not put raw evidence or excerpts into chat presentation metadata merely to make a citation
  look richer. Resolve the authorized source when the user opens it.
- Do not automatically retry an unknown, permanent, cancelled, destructive, or externally
  ambiguous outcome. Retry classification and the persisted attempt/cost budget are mandatory.
- Do not make a daemon timer the only recovery mechanism. A persisted due retry must reconcile
  through the provider after process restart.
- Do not collect response text or user prompts as quality telemetry. A maintainer may author a
  safe reproduction during review; production collection remains structural and metadata-only.
- Do not assume the empty per-vault cache key in tests. Bind the test vault through the same
  active-vault context variable as production and clear that exact key; otherwise the full test
  suite becomes order-dependent when another test leaves request context active.
- Do not let deterministic scheduling assertions inherit the wall clock. Supply an explicit
  status date; weekend execution can otherwise change task slack and make CI day-dependent.
