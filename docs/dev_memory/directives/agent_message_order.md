# Directive: Agent response and provider message order

## Objective

Ensure every chat turn produces a user-visible response while preserving the
message sequence required by strict providers such as Mistral.

## Procedure

1. Route an unrecognised supervisor decision to General so a first user turn
   cannot end without a response.
2. When Coder or Brain completes without pending tool calls, end the graph
   directly. The next HTTP request appends a user message before a new
   supervisor invocation.
3. Keep the specialist-to-tool-to-specialist loop while a tool call is pending.
4. Test both the fallback route and the completed-specialist routes.

## Restrictions / Edge Cases

- Do not route a completed Coder or Brain response back to the supervisor. It
  makes `assistant` the last message in a subsequent provider call and Mistral
  rejects it with `invalid_request_message_order`.
- Do not map an unknown initial supervisor decision to END. It produces an
  empty chat turn; route it to General instead.
