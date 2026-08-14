# Directive: Agent Response Performance and Deterministic Synthesis

**Status:** Implemented and verified locally.
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
- Backend tests, frontend tests and build, native browser validation, a real end-to-end chat
  turn, and the documentation gate all pass before publication.

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
