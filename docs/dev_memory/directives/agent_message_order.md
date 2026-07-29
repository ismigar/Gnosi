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
12. Treat secret-bearing files as prohibited even for read-only code tools.
    Read access is not safe when its output is sent to a remote model.
13. Classify MCP tools through explicit risk metadata or an exact allowlist.
    A verb-like name prefix is never a security boundary.
14. Bind each pending response to its original Vault, agent, and session. Abort
    or ignore it when the user changes any of those scopes.
15. Route mentions and explicit integration intents to a tool-capable worker.
    The short-message optimization applies only to clear conversational turns.
16. Build specialist prompts from the tools actually bound to that specialist.
    Never advertise unavailable mutation tools.
17. Check model capabilities before binding tools and normalize structured
    content blocks into renderable text.
18. Enforce per-request attachment count and total extracted-context limits,
    reject unsupported visual analysis, and remove abandoned/expired uploads.
19. Apply an overall turn deadline in addition to per-provider-call timeouts.
20. Count only a final assistant answer or explicit error as a completed
    response; tool progress alone is not a final answer.
21. Bound browser session history and checkpoint retention. Persistence must
    degrade gracefully when browser storage is full.
22. Stream only the minimum tool lifecycle metadata required by the UI. Tool
    arguments and results remain server-side unless a dedicated, authorized
    result-view flow explicitly requests them.
23. Own attachment cleanup at the outer request boundary so validation,
    workflow construction, provider selection, disconnects, and streaming
    failures all remove temporary uploads.
24. Treat unknown model capabilities as unsupported. Tool binding requires
    positive capability evidence from the model registry or agent profile.
25. Apply least privilege independently to every specialist. Code inspection
    does not imply access to memories, Vault contents, or external sources.
26. Report read-only MCP tools rejected for missing safety metadata as
    unavailable capabilities instead of silently implying integration access.
27. When browser retention evicts a session, remove its backend checkpoint as
    well. Automatic retention and explicit deletion follow the same cleanup
    path.
28. Localize generated session names and other assistant UI defaults in every
    supported locale.

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
- Do not expose `.env*`, key files, credentials, local data, or secret stores
  through code-inspection tools.
- Do not infer MCP safety from `get_`, `read_`, or similar prefixes. A tool can
  mutate regardless of its name.
- Do not let a response update whichever session happens to be visible when it
  arrives. Compare the original request scope before applying every event.
- Do not accept image attachments unless their bytes are sent to a
  vision-capable model. A filename is not visual understanding.
- Do not extract an entire PDF before enforcing limits. Stop at the page,
  character, and time budget.
- Do not allow unbounded localStorage histories, attachment directories, or
  checkpoint databases.
- Do not serialize tool arguments or tool outputs into the browser stream when
  the UI only needs a tool name and lifecycle status.
- Do not place attachment cleanup solely inside the stream generator. Errors
  before the first yielded byte bypass that generator.
- Do not assume a custom or unknown model supports tool calling. A false
  positive fails the entire turn during tool binding; fail closed and run the
  model without tools.
- Do not give Coder general read access to personal memory or Vault data.
- Do not silently discard integrations whose tools lack safety metadata;
  surface their unavailable status without exposing unsafe tools.
- Do not evict browser session metadata while retaining its server checkpoint.
- Do not hard-code the default conversation title in one language.
