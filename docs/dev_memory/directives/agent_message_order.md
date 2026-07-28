# Directive: Agent message order for provider compatibility

## Objective

Keep every LLM invocation compatible with providers that require the final
conversation message to be from the user or from a tool.

## Diagnosis

The multi-agent graph routes an initial user turn through the supervisor and
then a specialist. Once a specialist produces its final assistant reply, the
previous graph returned it to the supervisor. That made the supervisor invoke
the provider with an assistant message as the final conversational turn.
Mistral rejects this sequence with `invalid_request_message_order`.

## Procedure

1. The supervisor routes only an incoming user or tool turn to one specialist.
2. A specialist with tool calls runs its tool node and continues itself until
   it produces a final reply.
3. A specialist without pending tool calls ends the graph directly. Its reply
   is retained in the checkpoint; the following HTTP request appends the next
   user message before another supervisor invocation.
4. Cover both Coder and Brain routing paths with a regression test that
   verifies their final no-tool outcome targets the graph end, never the
   supervisor.

## Restrictions / Edge Cases

- Do not return a completed specialist reply to the supervisor; it causes
  Mistral error `invalid_request_message_order` because the provider receives
  `assistant` as the last message. End the graph and wait for the next user
  turn instead.
- Keep the specialist-to-tool-to-specialist loop for actual tool calls; ending
  before ToolNode would discard the requested tool execution.
