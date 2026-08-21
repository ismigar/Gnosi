# Directive: Universal AI Runtime Phase Two

**Status:** Implemented and verified.
**Origin:** 2026-08-21.

## Purpose

Complete the universal agent runtime with durable stream recovery, real-model
evaluations, profile-owned adaptive routing, provider-neutral durable jobs,
editable memory, versioned provenance, semantic taint propagation, and a
versioned capability-conformance contract.

## Model strategy and agent ownership

The configured agent remains the sole authority for model selection. Its
`provider` and `model` fields define the primary model and trust boundary.
Conversation clients continue to send `llm_mode=agent_default` and never expose
an independent model picker.

Each agent may declare one explicit `model_strategy`:

- `pinned` is the default and invokes only the assigned primary model.
- `resilient` invokes the primary first and may use an explicitly allowlisted
  alternative only after a transient provider failure.
- `adaptive` chooses among the primary and explicitly allowlisted alternatives
  from current-turn requirements, empirical evaluation quality, health,
  latency, and budget. The primary remains the deterministic fallback.

Every alternative must be an enabled router-registry row, support the agent's
active capabilities, and have the same local/remote locality as the primary.
Saving the strategy must fail closed for an invalid route. Provider credentials,
catalog defaults, or an older turn must never expand the allowlist.

## Durable stream recovery

- Produce agent events independently from the HTTP subscriber once a turn is
  accepted. A dropped browser connection must not cancel an otherwise healthy
  bounded turn.
- Store a short-lived encrypted event journal outside the Vault. Bind it to
  hashed workspace, user, agent, and session scope; retain it for at most one
  hour and delete it through periodic maintenance.
- Resume by opaque stream id and last applied sequence. Replayed events retain
  their original event ids and sequences, so the client remains idempotent.
- Explicit cancellation still reaches the provider bridge. Reconnection never
  repeats a model call, tool call, pending confirmation, or external action.

## Real-model evaluations

- Real-model evaluations are explicit, cost-bearing operations and never run
  silently when Settings opens.
- Use synthetic, non-private multilingual prompts. Record only model identity,
  task class, bounded scores, token counts, latency, cost, and stable failure
  codes; never persist prompts or generated responses.
- Adaptive routing may consume reviewed evaluation aggregates but cannot grant
  a model, provider, skill, tool, or privacy transition.

## Universal durable jobs

- Durable job providers and queue dispatchers register through versioned
  contracts instead of hard-coded worker branches.
- Every job declares provider, kind, idempotency key, lease, attempt and model
  budgets, status/result capabilities, cancellation, and resumption behavior.
- Unknown or schema-invalid jobs fail visibly. Consequential jobs keep their
  existing confirmation requirements and unknown-outcome rules.

## Editable long-term memory

- User memory is an explicit first-party store separate from conversation
  checkpoints and semantic vocabulary mappings.
- Each item exposes id, text, category, provenance label, creation/update time,
  optional expiry, enabled state, and revision. Users can create, edit, disable,
  or delete it.
- Memory writes are reversible local writes. Runtime retrieval is bounded,
  user/vault/agent scoped, excludes expired or disabled items, and never grants
  a tool or overrides safety policy.

## Versioned provenance

- Every cited source carries a bounded version fingerprint derived from an
  authoritative revision, etag, updated timestamp, or payload digest observed
  in the current turn.
- The UI distinguishes exact and unknown source versions. It never exposes raw
  bodies, local filesystem paths, or secret connector identifiers.

## Semantic evidence security

- Inspect attachment and tool evidence for prompt-injection, secret-exfiltration,
  authority-spoofing, and tool-coercion markers.
- Propagate bounded taint categories through current-turn metadata and final
  verification. Source text remains data; taint never becomes authorization.
- Add adversarial evaluation cases proving that source instructions cannot
  broaden tool selection or claim an action completed.

## Capability conformance

- Capability contracts declare a schema version plus stable identity, input and
  output schemas, effects, role, confirmation, timeout, idempotency, privacy,
  egress, and durable-result behavior.
- New versioned skills/tools fail closed when required fields are missing.
  Legacy capabilities remain visible with an explicit `legacy` or `partial`
  status until migrated; conformance metadata alone never makes them executable.
- Settings exposes aggregate and per-capability conformance without showing
  implementation code, credentials, or private arguments.

## Verification

Completion requires provider-free unit and adversarial evaluations, injected
real-model runner tests, stream disconnect/resume tests, agent-strategy tests,
durable dispatcher recovery tests, memory CRUD and expiry tests, citation
version tests, capability conformance tests, all four locale catalogs, frontend
build and tests, backend suite, isolated browser QA, and the engineering
documentation gate.

## Verification record

- The focused universal-runtime, adaptive-quality, resilience, and skill-runtime
  suites pass with 86 tests.
- The complete backend run passes 1,931 in-process tests; its five live HTTP
  etag cases also pass against the native backend.
- The provider-free adversarial response corpus passes all five cases.
- Frontend message utilities pass 16 tests, all four locale catalogs validate,
  and the production bundle builds successfully.
- Browser QA confirms the separate assigned-model field, profile-owned strategy
  selector, explicit real-model evaluation warning, editable memory, and
  capability-conformance summary render without a React failure.
