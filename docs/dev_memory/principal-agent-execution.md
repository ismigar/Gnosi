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
