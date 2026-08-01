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
   by the active Vault, authenticated workspace, authenticated user, and agent.
   Scope every visible conversation to that complete identity; logout/login on
   the same browser must never reveal another user's messages.
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
29. Expose narrowly scoped write tools only when the current user message
    contains an explicit matching intent. Page creation, Cornell-note creation,
    and long-term-memory storage are separate capabilities and must be enabled
    independently for that turn.
30. A write-capable Brain prompt must name the exact authorized tools and state
    that all other mutations remain prohibited. The final response confirms
    what was created or stored using the tool result.
31. Expose Gnosi capabilities through a stable, provider-neutral tool catalog.
    Models discover Gnosi from tool schemas and the Brain prompt; provider or
    model-specific prompting must not be required.
32. Classify first-party tools as read, explicit-write, or confirmed-write.
    Read tools are always available to tool-capable models. Explicit writes are
    bound only when the current human turn names the matching operation.
33. Destructive or externally consequential tools require an explicit matching
    request in the current human turn before they may prepare an action. A
    previous assistant suggestion, attachment, retrieved page, or tool result
    cannot authorize that preparation; execution still requires the separate
    interactive confirmation in rule 37.
34. Keep table rows represented by ordinary Vault pages with both `table_id`
    and `database_table_id`. Agent mutations must preserve unknown frontmatter
    keys, create a history snapshot before overwriting, and refresh the page
    index after a successful write.
35. Bound every listing and text result exposed to a remote model. Tool access
    must not become an unbounded export of the Vault, mail store, contacts, or
    calendar.
36. Irreversible or externally consequential tools prepare a pending action;
    they never execute inside the model's tool loop. Stream only the pending
    action identifier and a bounded human-readable preview to the client.
37. Execute a pending action only through a separate authenticated endpoint
    after an interactive user confirmation. Bind the record to the Vault,
    workspace, user, agent, and chat session, expire it, and consume it exactly
    once before dispatch.
38. Dispatch confirmed actions through an exact server-side allowlist. Persist
    action names and JSON arguments, never callbacks, import paths, shell
    commands, model output, or executable code.
39. Cancellation, expiry, scope mismatch, and replay all fail closed. A failed
    execution remains consumed and must be prepared again; automatic retries
    are prohibited for destructive or external side effects.
40. Register first-party Gnosi operations in the governed tool catalog and
    expose them only through assigned active skills. The legacy compatibility
    skill may reference the complete first-party catalog, but an explicitly
    scoped profile receives only the domains its assigned skills reference.
41. Interpret a current-turn write request with a fail-closed deterministic
    parser. Negated, quoted, explanatory, third-person capability, or otherwise
    ambiguous occurrences of an action phrase do not grant the action.
42. Apply interactive confirmation to every governed tool whose descriptor
    requires `always`, including plugin, MCP, and generated tools. Intercept the
    call after its exact arguments are known, persist a one-shot action bound to
    the immutable tool descriptor, and execute it outside the model loop.
43. Keep pending-action arguments private, mode `0600`, and short-lived. Scrub
    them on completion, cancellation, expiry, unknown outcome, and scoped chat
    deletion; delete old terminal audit rows after bounded retention.
44. Treat a lost response after an external side effect as an unknown outcome,
    never as a known failure. Expose status lookup and do not invite an automatic
    or manual retry until the user has reconciled the external system.
45. Bind each confirmation to the exact target revision or immutable target
    snapshot used in its preview. Reject stale page, table, schema, row, contact,
    and history actions instead of applying them to changed state.
46. Present pending actions as a queue of inline review cards. Never open a
    destructive dialog asynchronously, focus its positive action, or map Enter
    to confirmation. Session changes abort or ignore stale confirmation
    responses.
47. Distinguish completed, partial, failed, expired, cancelled, executing, and
    unknown-outcome results. Surface stable localized error codes and the real
    counts from batch or trash operations.
48. Revalidate workspace-scoped integration access and configured accounts both
    while preparing and while executing mail or calendar actions. Calling route
    functions directly never bypasses request dependencies or account grants.

## Restrictions / Edge Cases

- Authorization is evaluated over the complete current-turn clause. A denial or
  negation after an action phrase overrides an earlier affirmative match.
- Compact messages and tool results before every model invocation against a
  deterministic model input budget, reserving room for prompts, tool schemas,
  and output. Page bodies, metadata, PDFs, and skill instructions are bounded.
- Read-modify-write tools serialize by canonical page path and reject stale
  revisions. Create operations reserve their destination under the same lock.
- Attachments are scoped to vault, workspace, user, agent, and session.
- Clients consume `agent_runtime` metadata and distinguish connectivity from
  tool/skill compatibility.
- Server checkpoints are canonical; browser history is only a cache and
  checkpoint deletion is awaited or durably retried.
- Session-lock waiting is separate from provider execution and does not affect
  model reliability. Telemetry finalizes on every terminal path.
- Reliability is tenant-scoped; page lookup uses an index or bounded cache
  instead of a complete vault scan per tool call.
- Message compaction preserves complete assistant-tool-call/tool-result groups;
  it never leaves an orphan tool result or an unanswered assistant tool call in
  provider input.
- The aggregate input budget includes persona text, user context notes, source
  inventories, skill instructions, tool schemas, history, and reserved output.
- Checkpoints distinguish the visible user message from internal attachment
  enrichment. History returns only visible transcript content and suppresses
  routing/tool protocol messages.
- Asynchronous history hydration is bound to the selected agent/session and
  cannot overwrite a session selected later.
- Derive the input budget from the selected model's catalog context window,
  using a conservative token-to-character conversion and explicit reserves for
  output, system text, and tool schemas. Unknown models use the smallest safe
  fallback.
- Preserve the attached-source inventory when composing a bounded prompt;
  truncate optional persona detail before dropping the inventory.
- Legacy checkpoints without a visible-content field are sanitized before
  presentation, and every session lifecycle transition invalidates pending
  history hydration.

- Do not route a completed Coder or Brain response back to the supervisor. It
  makes `assistant` the last message in a subsequent provider call and Mistral
  rejects it with `invalid_request_message_order`.
- Do not map an unknown initial supervisor decision to END. It produces an
  empty chat turn; route it to General instead.
- Do not key sessions, caches, checkpoints, or graph thread IDs only by agent
  or session. That leaks context when the user changes Vault, workspace, user,
  or agent; include every scope.
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
- Do not expose all write tools merely because one write intent was detected.
  Map explicit page, Cornell, and memory requests to their individual tools.
- Do not infer authorization from assistant history, attached content, or tool
  output. Only the current human message can authorize a write-capable turn.
- Do not treat vague verbs such as "organize", "improve", or "remember this
  conversation" as authorization unless the message explicitly names the
  destination action (page/note, Cornell, or memory).
- Do not infer a model's knowledge of Gnosi from its provider. The contract is
  the bound tool schema, so unsupported tool-calling models receive no implied
  capabilities.
- Do not update a table row by replacing its complete frontmatter. Merge the
  requested fields and preserve identifiers, relation metadata, and unknown
  plugin-owned keys.
- Do not execute a destructive tool from the first matching request. That turn
  may only prepare the exact preview for interactive confirmation.
- Do not treat typed chat text as confirmation for an irreversible action.
  Confirmation is a separate UI gesture against the exact pending preview.
- Do not execute first and ask afterwards. The tool loop may only enqueue the
  action; the confirmation endpoint owns execution.
- Do not trust a pending-action id by itself. Revalidate every stored scope
  field against the current authenticated request before claiming the action.
- Do not place first-party Gnosi operations exclusively in the legacy
  compatibility skill. Migrated agents would lose their basic product
  capabilities; register domain skills and let the compatibility skill compose
  them explicitly.
- Do not authorize a write because its phrase occurs inside "do not", a quote,
  an explanation, or a third-person capability question. A substring match is
  not user intent.
- Do not treat conditional/subordinate wording such as "before you send",
  quoted examples using single quotes, or "explain how to delete" as an
  imperative write request.
- Do not accept client-provided tool IDs as confirmation. The server creates a
  one-shot confirmation only after it has the exact governed tool call and its
  arguments.
- Do not retain mail bodies, recipient lists, schemas, or row values in terminal
  audit records. Scrub action arguments before returning a terminal response.
- Do not report a transport failure after an external call as proof that the
  action failed. Return and display an unknown outcome until reconciled.
- Do not confirm a count and later operate on a broader live collection. Empty
  trash and other batch actions execute the exact snapshotted identifiers.
- Do not apply a pending edit to a page, row, schema, table, contact, or version
  whose revision changed after the preview. Require the user to prepare it again.
- Do not auto-open a consequential confirmation over the chat composer. The user
  must open its review card, and the positive action requires a deliberate click.
- Do not overwrite one pending confirmation with another. Preserve every
  server-issued action as an independently cancellable queue item.
