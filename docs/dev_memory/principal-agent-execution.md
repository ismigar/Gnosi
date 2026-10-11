# Principal Agent execution

Functional AI requests enter `backend.services.agent_execution`, independent of
HTTP chat. Chat and capability schedules use its governed graph streaming boundary;
buttons and long-job phases use its tool-free structured operation graph. Both
invoke the same policy transport, memory preparation, skill catalog, cancellation
mechanism and usage ledger. Functional services cannot choose an alternative model.

## Contract and ownership

`AgentOperation` identifies the operation, assigned skill, input, evidence references,
language, origin, output schema and parent run. Adapters fetch authorized evidence
and prepare the operation-specific contract; evidence references describe provenance
and never grant access. The server binds the authenticated user, workspace, role and
Vault with `ExecutionScope`. Workers persist this scope and revalidate current
membership and Vault access before model calls and actions.

A snapshot freezes the principal's profile, model strategy, effective instructions,
assigned skill instructions and versions. Nested operations can select only skills
assigned in that snapshot, while current assignment revocation still takes effect.
Each phase has a `run_id`. `agent_runs.sqlite` is private and scope-filtered; run
payloads never expose the internal profile snapshot. A synchronous adapter also
returns `X-Agent-Run-Id`.

Structured answers are validated before completion. At most one repair is allowed,
within the original deadline and phase/job call budget. Semantic validators, such as
Knowledge citation and coverage checks, use that same allowance. Failed validation
cannot produce a completed result. Model fallback candidates remain limited to the
principal's declared policy; legacy feature clients never run after failure.

## Durable work

Reader and notebook jobs retain their feature queues and deterministic persistence.
Knowledge ingestion retains its extraction, review and write checkpoints. Their
AI phases enter the shared executor. Successful identical phases can be reused only
within the same parent job and snapshot revision, with validation repeated on reuse.
No old incompatible phase is promoted into a new snapshot.

`GET /api/agent/runs` and `GET /api/agent/runs/{run_id}` expose scoped activity.
Cancellation signals live inference and prevents subsequent phases. A per-process
instance identifier also detects interrupted work when a restart reuses its PID. Explicit resume
atomically claims a failed/interrupted execution; the API never independently retries
a specialized engine, conversational action, or contextual phase whose parent owns
its semantic validation and persistence. Such runs expose `resumable: false` and
retain their original feature entrypoint. Legacy queued work without reconstructible
scope is marked interrupted with `agent_job_requires_authorized_restart` instead
of using ambient credentials. Explicit Reader resume starts a fresh authorized run
without reusing legacy AI phases; other features retain their original entrypoint.

## Knowledge migration

Version 1 runs once per Vault configuration and first writes
`params.yaml.before-principal-v1`. Only the `llm-wiki` profile marked
`managed_by: llm-wiki` is retired. Personal profiles named Brain remain intact.
A managed principal is replaced by a personal profile carrying its model settings.
Its specialized instructions become a deterministic user skill, activated only with
Knowledge. Original settings remain in the backup and retired profile. Existing
memories remain scoped to their original user and Vault and are included only for
Knowledge operations.

Equivalent skills are assigned for already enabled features. Plugin state and
schedules are not enabled by the migration. Existing source, page, relation and table
identifiers remain unchanged. `/api/vault/knowledge/*` aliases the existing Knowledge
handlers and authorization dependencies; `/api/vault/llm-wiki/*` and Brain table
URLs remain compatible. Notion continues as an independent optional connector.

## Specialized and diagnostic execution

Whisper, TrOCR, speech synthesis and semantic ranking are catalog tools with typed
inputs and audited engine activity. Functional translation always uses the principal;
Softcatalà, Apertium, OPUS and DeepL are no longer implicit translation routes.
Connection probes and explicit evaluations enter the diagnostic transport with an
administrative scope, selected model, one-call budget and shared usage ledger. They
cannot be used to resume a functional operation.

## Regression checks

`python scripts/check_agent_execution_boundary.py` runs in CI and the pre-PR checks.
It rejects direct model factories, known SDK constructors and direct model invocation
in functional modules. Exceptions are explicitly confined to central transport and
diagnostics. `backend/tests/test_agent_execution.py` covers structured repair,
permissions, scope isolation, cancellation, interrupted runs, atomic resume, budgets,
phase reuse, migration backups, personal-profile preservation and Knowledge aliases.
The principal reference component is tested in Catalan, Spanish, English and French.

The standalone OPML-to-podcast command also uses the principal podcast operation and audited speech engine. Provider failures propagate and cannot become a saved error-text podcast; the static boundary rejects provider SDK constructors and completion/message/response creation outside the central adapters.

Validation follow-up: main CI exceeded the PDF composition child-suite 90-second watchdog in both import orders while assertions were still progressing. Align that whole-suite watchdog with the existing 300-second drawing/citation checks; keep all PDF contract assertions and the fatal return-code check.

HTTP scope is bound through the dependencies of each `app.include_router` call. Mutating a router's dependency list after its routes have been defined does not execute that dependency. A real HTTP regression exercises all thirteen functional adapters and verifies the authenticated user, workspace, role, Vault and context cleanup before returning the response.

Trigger origin is carried by the execution context and durable snapshot. Child operations inherit their active parent's origin, so scheduled work is not mislabeled as a button request. Scope cleanup restores the previous origin together with the user and Vault; standalone RSS execution explicitly identifies itself as worker-originated.

## Saved-title action evidence

Exact quoted title substitutions use a tool-bearing Vault skill through the existing team executor, skipping director reasoning. Validate activated tools per assignment; refuse action completion without a successful authorized tool result or pending confirmation. Resolve the unique saved view from complete attached page content and narrow all context tools to it, including direct executors. Bind title inventory and confirmation to saved-view and row revisions. Keep complete JSON through secret redaction; use the declared bounded bulk argument budget. The synthetic 748/31 integration verifies actual writes and excluded rows, not only generated plans.


2026-10-11: The production retry with a typed @page bypassed title authorization and spent 94.5 s across two planning calls. Its source context contained only the broad Vault and persistent sources. Regression acceptance now starts at the HTTP chat boundary, without manually granted tools or pre-resolved scope. Preserve page and selected embed IDs through navigation, attach visible mentions, resolve only unique exact typed names, and bind `this` filters and confirmation to the host page. Multiple views without an active selection clarify locally. Validate the installed UI through a real pending preview before reporting completion.

2026-10-11 installed-UI follow-up: the real HTTP request reached `bulk_update_rows` with zero model calls, but the native guard compared the indexed schema title (`Nom`) with a divergent legacy `title`. Read, preview and confirmed writes must use the same schema field and native name/ID/alias precedence. Bind that field in the confirmation and reject schema changes. A preview-only test is insufficient: synthetic acceptance must confirm and inspect the visible saved field, with a deliberately stale internal title, while preserving unrelated rows. Leave the real user-data preview pending confirmation.

2026-10-11 UI freeze: emitting embedded context from an effect keyed by registry/view objects created a feedback loop when App received the event and rebuilt the editor context. A native row interaction reproduced sustained renderer CPU above 100%; the regression must mount a receiving parent which rerenders fresh equivalent registry/title objects. Memoize the published context using scalar page/table/view IDs and labels, and suppress repeated pointer/focus publications while that embed still owns the context. Keep selected-tab updates and reacquisition after another module takes ownership. Test the feedback boundary, not only a passive event collector.

2026-10-11 wording regression: the natural request about task names in the current view missed the literal-title path and failed after 81 seconds in a provider connection call. Cover scope synonyms and order changes as a complete finite grammar across four languages, through the HTTP boundary with no granted tools, not just isolated phrase matching. Negative and ambiguous requests must stay outside the local action. SDK connection errors are recoverable network errors, never unexplained internal failures or model-quality evidence. Repeat the exact production wording in the installed UI and measure its pending preview without confirming live writes.

## Scoped title continuations and truthful completion

A title-action checkpoint now retains the exact literal request and the saved table/view/host revision. A follow-up such as `Ara canvia "Fase " per "F". P.ex.: Fase 1 per F1` replaces the operands without losing their spaces; any illustrative example must agree with them. Bare assent prepares a fresh preview, never executes an old confirmation. Reuse stops at an unrelated human turn, extra attached context, another principal, or a changed view/host/filter revision. Legacy conversations recover only from a matching scoped server preview and execution trace, never assistant prose. HTTP continuation regressions include actual confirmed writes over 31 of 748 rows and zero model calls. The bulk writer reads back each visible title before reporting completion and rolls back a failed verification. The chat reconciles a missing confirmation status once and never treats HTTP success or an unknown outcome as completed.

## Confirmation presentation and immediate view refresh

Team confirmations are emitted as native confirmation events and checkpoint cards, so their JSON never becomes an assistant bubble. Older raw JSON is converted only when its ID matches a scoped server confirmation; duplicates collapse to one card while preserving turn metadata, user quotes and unrelated messages. A completed or partially completed Vault action invalidates the sidebar cache and broadcasts one preview invalidation per batch, refreshing mounted views without a focus change or clearing their search. Late completions never reload another active Vault. Conversation rewind and deletion acquire the existing bounded session lock; a busy session returns `chat_session_busy` instead of waiting indefinitely, with a localized explanation and unchanged history.
