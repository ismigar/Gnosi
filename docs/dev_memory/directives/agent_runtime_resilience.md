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

## Verification

Run `backend/tests/test_agent_resilience.py`, the universal deterministic eval
runner, the focused agent/runtime tests, and the documentation gate before
publishing changes.
