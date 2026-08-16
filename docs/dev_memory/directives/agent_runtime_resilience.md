---
status: active
last_verified: 2026-08-16
---

# Agent runtime resilience

## Intent

Keep universal agent turns bounded when a provider, connector, tool, or client
fails. Runtime workflows are cached, so request-specific cancellation and
authorization must stay in graph state or an opaque registry token rather than
in construction closures.

## Rules

- Do not fail over a private local turn to a remote provider. Select only
  configured candidates with the same locality and retry transient transport,
  timeout, rate-limit, or 5xx failures; authentication and policy failures are
  terminal.
- Do not pass raw Vault, attachment, connector, or web text as instructions.
  Delimit it as untrusted evidence, flag injection-like phrases, and keep tool
  authorization server-owned.
- Do not keep cancellation events in checkpoints. Store only an opaque token,
  signal it when the stream detects a disconnected client, and release it after
  graph completion.
- Do not advertise malformed or handler-less skill tools as available. Include
  a bounded health status in runtime metadata and exclude unavailable tools from
  model selection.
- Do not cache prompts or unbounded source bodies. Query caches use a short TTL,
  a bounded entry count, and normalized Brain/query/k keys.
- Do not treat estimated cost as accounting truth. The persistent usage ledger
  records actual catalog-priced tokens; estimates are display-only diagnostics.
- Do not merely skip the next graph node when a client disconnects. Provider
  calls must go through the cancellation bridge; use async provider invocation
  when available so an in-flight HTTP task can be cancelled.
- Do not retry a provider indefinitely. Record transient failures in the
  bounded circuit breaker and expose cooldown state in diagnostics; leave
  authentication and policy errors terminal and visible.
- Do not emit uncorrelated operational logs. Generate one opaque trace id per
  turn and carry it through plan, model, tool, error, metrics, and completion
  events without storing prompt or source content.
- Do not run live HTTP E2E tests against the developer's native backend. They
  are opt-in, use isolated directories and a separate port, and must never
  mutate a real Vault.
- Do not use an in-process timer as the only source of truth for a background
  capability. Persist the job payload, idempotency key, lease, attempts, and
  retry time in the local durable queue; workers must claim and heartbeat the
  lease before doing model work.
- Do not attach arbitrary prompt, source, argument, or result values to an
  operational span. The observability contract accepts a small allowlist of
  bounded attributes and writes only redacted metadata.
- Do not route ambiguous requests directly to a guarded capability. Interpret
  the request with the bounded multilingual semantic contract first, expose
  confidence/abstention in the turn plan, and keep writes behind the existing
  role and confirmation gates.
- Do not rebuild a whole in-memory Brain search list for every query when the
  FTS5 sidecar exists. Use bounded FTS candidates, then hybrid-rank them with
  the deterministic vector cache; fall back to JSON only when the sidecar is
  unavailable.
- Do not let a tool accept unbounded arguments or return unbounded output.
  Validate fields before execution, enforce the descriptor timeout, truncate
  oversized results, and report the contract failure as a tool error.
- Do not execute generated tool code after its approval contract has drifted.
  Re-run the AST validator at load time, reject forbidden imports/attributes,
  and apply the URL egress policy to any connector-facing implementation.
- Do not process the same explicit turn id twice. Claim it durably in the
  workspace/user/session scope and mark the claim completed or failed after
  the stream closes.

## Verification

Run `backend/tests/test_agent_resilience.py`, the universal deterministic eval
runner, the focused agent/runtime tests, and the documentation gate before
publishing changes.
