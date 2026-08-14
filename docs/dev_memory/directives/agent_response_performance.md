# Directive: Agent Response Performance and Deterministic Synthesis

**Status:** Universal request contract implemented and verified locally.
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

Exact inventories reuse the persisted parsed-document cache and link index. Relation-aware
queries expand canonical links to indexed titles, while requests that explicitly ask what
records contain or mention a term disable relation expansion. A missing cache entry may fall
back to a direct governed read, but normal warm requests must not reopen every Vault file.

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
- The 2026-08-14 native verification covered 316 backend tests and a successful production
  frontend build. A real relation-aware “coaching” inventory returned 64 records (36 direct
  matches and 28 relation matches) with one tool call, no model call, and between 1.156 and
  2.343 seconds of server time in the recorded warm runs. A browser turn requesting the live
  `Titulaciones` table returned all 11 records, displayed the undo control, and completed in
  one visible second without console errors; a later API run of the alternative “Mostra’m”
  phrasing completed in 1.784 seconds.

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
- Do not add a hard-coded intent branch for each topic. Classify the operation and pass the
  remaining subject terms to the generic inventory or lookup implementation.
- Do not infer an exact record type from a loose topic word when no attached registry table
  matches it. Search all authorized attached types and report their actual type names.
- Do not silently present the first page as complete. Exact counts and pagination status are
  part of the response contract.
- Do not force the default Vault merely because it is attached. Explicit non-Vault domains
  use their own assigned skills and tools unless the request also names Vault content.
