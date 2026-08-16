# Agent turn budgets

## Purpose

Every request receives one provider-independent operational budget from the
universal turn planner. The budget is metadata for the runtime, telemetry, and
the client; it is not a replacement for authorization or user confirmation.

## Rules

- Keep `timeout_seconds`, `max_model_calls`, `max_tool_calls`, and
  `max_read_tool_results` in the turn plan.
- Enforce the model and tool budgets inside the graph before invoking another
  provider or tool. Synthesize from the evidence already available when a
  budget is reached.
- Keep the HTTP timeout as the final cancellation boundary. Do not rely on a
  prompt instruction to stop a loop.
- Expose the bounded budget in the initial `turn_plan` event and final timing
  metadata so a user can understand why a turn stopped.
- Do not count a timeout or graph-recursion stop as model-reliability evidence;
  those are runtime signals and use the stable `agent_turn_timeout` or
  `agent_loop_exhausted` error codes.

## Restrictions / Edge Cases

- Do not restore large `pip` caches on the self-hosted ARM backend runner → the
  archive can time out before tests begin → install dependencies directly.
- Do not use a zero budget as an implicit “deny everything” signal. A zero
  `max_tool_calls` means that the request mode should not use tools; required
  deterministic context reads still run through their explicit server-owned
  path.
- Do not increase a budget from model output or tool arguments. Only the
  server-owned planner may select it.
