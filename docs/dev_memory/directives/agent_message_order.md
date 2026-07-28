# Directive: Agent chat isolation, safety, and response protocol

## Objective

Ensure every chat turn is isolated to one Vault and one agent, uses only
request-authorized capabilities, and produces a verifiable user-visible
response while preserving the message sequence required by strict providers
such as Mistral.

## Procedure

1. Route an unrecognised supervisor decision to General so a first user turn
   cannot end without a response.
2. When Coder or Brain completes without pending tool calls, end the graph
   directly. The next HTTP request appends a user message before a new
   supervisor invocation.
3. Keep the specialist-to-tool-to-specialist loop while a tool call is pending.
4. Test both the fallback route and the completed-specialist routes.
5. Namespace browser sessions, graph caches, checkpoint files, and thread IDs
   by the active Vault. Scope every visible conversation to its selected agent.
6. Validate agent and session identifiers as opaque identifiers before using
   them. Derive filesystem names from hashes, never from request text.
7. Upload chat attachments to a dedicated directory in the active Vault.
   Resolve and validate attachment paths again when a message consumes them,
   then add bounded extracted text to the prompt.
8. Bind read-only tools by default. Mutating, code-executing, generated, and
   Vault-writing tools require a separate explicit approval flow and must not
   be exposed to an ordinary chat turn.
9. Route obvious general conversation without an LLM supervisor call. Keep the
   supervisor only for ambiguous requests and specialist routing.
10. Configure the provider client with a finite timeout and emit a terminal
    NDJSON `done` event containing whether a visible response was produced.
11. The frontend creates an assistant bubble only for response-bearing events.
    A terminal stream without a response becomes an explicit localized error.

## Restrictions / Edge Cases

- Do not route a completed Coder or Brain response back to the supervisor. It
  makes `assistant` the last message in a subsequent provider call and Mistral
  rejects it with `invalid_request_message_order`.
- Do not map an unknown initial supervisor decision to END. It produces an
  empty chat turn; route it to General instead.
- Do not key sessions, caches, checkpoints, or graph thread IDs only by agent
  or session. That leaks context when the user changes Vault or agent; include
  both scopes.
- Do not interpolate request identifiers into paths. A slash or `..` can
  escape the checkpoint directory; validate the identifier and hash the
  resulting scope instead.
- Do not reuse a cover-image endpoint for chat files. It neither represents
  arbitrary attachments nor proves the model consumed them; use the dedicated
  attachment endpoint and revalidate containment on read.
- Do not bind mutation tools merely because the deployment is local. Local
  execution still lacks per-invocation user consent; expose only read-only
  tools until an approval token is implemented.
- Do not create an empty assistant message for metadata such as
  `llm_selected`. Wait for a message, tool event, or error, and verify `done`.
- Do not invoke the supervisor for greetings and ordinary general questions.
  It doubles latency without improving the answer; route deterministic general
  cases directly.
