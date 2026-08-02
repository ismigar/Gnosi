# DIRECTIVE: GNOSI CAPABILITY PLATFORM

> ID: 2026-08-02-capability-platform
> Associated components: AI skills, governed tools, internal sources, durable jobs, automations, approvals, audit, Settings
> Last Update: 2026-08-02
> Status: ACTIVE

---

## 1. Objectives and Scope

- Turn Gnosi's existing module APIs into a composable capability platform.
- Preserve the separation between data sources, atomic tools, reusable skills,
  scheduled automations, and optional agent profiles.
- Extend first-party sources beyond Reader, Mail, Calendar, and Contacts where
  an authoritative Gnosi service can provide bounded inventory, search, and
  exact-record reads.
- Promote user-facing operational skills into the governed AI catalog without
  exposing developer or infrastructure tools to normal agents.
- Provide reusable durable-job controls, cost estimates, audit records,
  budgets, and approval queues for long-running or consequential workflows.
- Ship high-value cross-domain skills for briefings, research, inbox triage,
  meeting preparation, knowledge capture, project review, relationship context,
  publishing, translation, and migration.

### Success criteria

- Every runtime tool has a stable descriptor, typed input and output contracts,
  effects, minimum role, confirmation policy, and origin metadata.
- Dynamic context tools expose one-source inventory/search/read operations and
  never search unrelated attached sources unless explicitly requested.
- Long operations use one provider-neutral job facade with durable status,
  result, resume, cancel, and cost-estimate semantics where supported.
- Planning, References, Brain, Social, Meetings, and Notion appear as sources
  only when their authoritative adapter is available and can enforce scope.
- Existing Reader, Mail, Calendar, Contacts, Vault, Planning, Social,
  Translation, Notion, References, Meetings, and publishing APIs have governed
  tools for the safe operations that they actually support.
- Cross-domain skills compose tools rather than duplicating business logic.
- Scheduled skills have source grants, cost budgets, idempotency, run history,
  and an approval queue; external writes never execute unattended.
- Settings can inspect skills, tools, effects, jobs, automations, budgets,
  approvals, and audit history in all supported locales.
- Backend tests, frontend tests, production build, browser validation, and
  end-to-end flows pass in the native runtime.

## 2. Capability Boundaries

### Source

- Grants bounded read access to a server-validated data scope.
- Never grants mutation rights.
- Returns inventories, bounded searches, stable record ids, and exact records.

### Tool

- Performs one deterministic operation against an authoritative service.
- Receives typed bounded inputs and returns structured output with provenance.
- Declares all effects and never hides a write or model cost inside a read.

### Skill

- Contains reusable instructions and an explicit tool set.
- May coordinate multiple sources and tools but owns no credentials.
- Uses automatic activation only for safe reads; model-costing and write
  workflows require explicit activation or a pre-authorized automation budget.

### Automation

- Invokes one skill from a schedule or trusted Gnosi event.
- Stores exact source grants, agent/profile id, budget, idempotency key, and run
  history.
- May perform reads and budgeted AI work unattended. Any external write becomes
  a pending approval and never executes silently.

### Agent

- Is an optional reusable profile of behavior, skills, and sources.
- Is not the authorization boundary for module data or operations.

## 3. Effect and Authorization Model

- Preserve existing `read`, `local_write`, `external_write`, `destructive`,
  `code_execution`, and `ai_cost` effects.
- Add classification for `external_read`, `personal_data`, `data_egress`,
  `bulk_write`, `financial_cost`, and `notification`.
- Personal-data and external-read classifications remain constrained by source
  grants and role checks; they do not imply a write confirmation by themselves.
- Local writes, AI or financial cost, bulk writes, and data egress require an
  explicit current-turn request or a matching automation grant and budget.
- External writes and destructive actions always require a fresh interactive
  confirmation, including when initiated by an automation.
- Every mutation carries an idempotency key and a revision or precondition for
  the target when the provider supports one.

## 4. Provider-Neutral Job Contract

- Job ids are globally namespaced as `<provider>:<opaque-id>`.
- Public status includes provider, kind, state, phase, progress, timestamps,
  cost estimate/usage when available, resumability, cancellability, and a safe
  error summary.
- Provider adapters implement list, status, result, resume, and cancel only
  where the underlying operation supports them.
- Unsupported operations return explicit capabilities rather than pretending
  success.
- Reader analysis is the first complete provider and remains backward
  compatible with its existing endpoints and tools.

## 5. Initial Cross-Domain Skills

- Reader topic evolution: exact inventory, cost notice, durable analysis,
  citations, optional Vault capture.
- Daily briefing: Calendar, Mail, Reader, Planning, and reminders.
- Inbox triage: read-only prioritization first; optional reviewed mailbox
  mutations and reply drafts.
- Meeting preparation: Calendar event, attendees, Contacts, recent Mail, Vault,
  and Brain evidence.
- Knowledge capture: exact source record to structured Vault page with tags,
  links, and optional Brain processing.
- Research dossier: Reader, References, Vault, and Brain synthesis with cited
  evidence.
- Weekly review and project status: Planning state, allocations, schedules,
  baselines, Calendar, and activity evidence.
- Relationship brief and follow-up manager: Contacts, Mail, Calendar, and Vault.
- Social repurposing and publishing: source content to draft, schedule, and
  separately confirmed publish.
- Translation publishing: preview, translate, review, and separately publish.
- Notion migration: inspect, preview, start durable clone, verify, and repair.

## 6. Tool Design Rules

- Prefer a small exact tool over a broad endpoint wrapper.
- Do not expose raw credentials, filesystem paths, provider tokens, or global
  account selectors to the model.
- Re-resolve every account, workspace, vault, source, record, and job from the
  authenticated execution context.
- Clamp every list, search, date interval, attachment size, and output size.
- Require exact record ids from an earlier inventory or search for exact reads
  and mutations.
- Preserve untrusted-content delimiters around Mail, Reader, Social, Notion,
  meeting transcripts, and remote reference content.
- Produce preview and confirmation payloads from authoritative snapshots, not
  model-authored summaries.
- Keep generated Python tools outside normal user workflows until they execute
  in a real process sandbox.

## 7. Automation Rules

- Supported triggers are manual, interval, cron-like local time, and trusted
  internal events.
- Store the timezone and compute the next run deterministically.
- Enforce one active run per automation id and an idempotency window.
- Track daily and monthly AI/financial budgets separately.
- A budgeted run stops before the first call that would exceed its allowance.
- Automation output is a durable run record and notification; it is not only a
  transient chat response.
- Pausing an automation never deletes its history or approvals.

## 8. Restrictions and Edge Cases

- Never create one agent per module merely to grant data access.
- Never attach whole datasets to prompts or accept client-computed totals.
- Never register a source without exact containment tests.
- Never register a tool whose declared effects are weaker than its handler.
- Never let a skill activate a missing, suspended, or unassigned tool.
- Never execute external writes from schedules, webhooks, or model inference
  without a fresh user confirmation.
- Do not reuse the ten-minute chat confirmation TTL for unattended runs → the
  approval can expire before the user sees it → use the bounded 24-hour
  automation approval TTL instead.
- Do not reserve a second run while the same automation has a live run → two
  graphs can duplicate cost and prepared writes → reject the overlap atomically
  and recover only a run older than twice its runtime budget (minimum 15 min).
- Never treat a successful queue response as a completed job.
- Never lose job, automation, approval, or audit state on backend restart.
- Never log message bodies, article bodies, transcripts, credentials, or model
  prompts in audit metadata.
- Never expose maintenance, backup, E2E, autonomous-improver, or team-manager
  skills to ordinary user agents.

## 9. Implementation Sequence

1. Typed effects, runtime context descriptors, per-source search, schemas, and
   audit-safe metadata.
2. Provider-neutral durable-job facade and Reader adapter.
3. Additional internal source adapters and containment tests.
4. Governed domain tools over existing module services.
5. Cross-domain skill descriptors with exact activation policies.
6. Automation store, runner, budgets, approvals, audit, API, and Settings UI.
7. Full translations, unit/integration tests, native E2E, and public runbook.

## 10. Validation Checklist

- Catalog rejects under-declared effects and invalid activation/tool bindings.
- Dynamic context tools appear in runtime metadata with read-only policy.
- Per-source search cannot inspect another attached source.
- Every new source denies cross-workspace, cross-account, and out-of-scope ids.
- Every write produces the required preview/confirmation and respects target
  revisions and idempotency.
- Generic jobs survive reload and report unsupported operations honestly.
- Automation budgets, timezones, duplicate-run guards, pause/resume, approval
  creation, and restart recovery are covered by deterministic tests.
- UI exposes only available operations and has no missing locale keys.
- Native build, focused backend suites, browser DOM and screenshot checks, and
  real API flows pass before publication.

## 11. Learning Record

| Date | Finding | Consequence | Decision |
| --- | --- | --- | --- |
| 2026-08-02 | Gnosi already has many complete module APIs but only a subset are governed AI tools | Reimplementing business logic would create divergent behavior | Wrap authoritative services with narrow governed adapters |
| 2026-08-02 | Existing pipeline skills mix user workflows with developer runbooks | Publishing all of them would expose unsafe infrastructure capabilities | Promote only user-facing workflows; keep operational skills internal |
| 2026-08-02 | Context tools are scoped correctly but do not have first-class runtime descriptors | Audit/UI metadata cannot fully explain their active policy | Add dynamic read-only descriptors derived from validated refs |
| 2026-08-02 | Reader and Brain have separate durable job stores | Every new long task would otherwise invent another control surface | Introduce a provider-neutral facade before adding more long jobs |
| 2026-08-02 | Automation-created confirmations were scoped correctly but the normal ten-minute TTL was too short | Overnight external-write proposals would expire unseen | Keep normal chat TTLs and grant governed automation proposals a bounded 24-hour TTL |
| 2026-08-02 | A daily run budget does not prevent concurrent duplicate runs | Scheduler and manual execution could overlap before either finishes | Reserve runs under `BEGIN IMMEDIATE`, reject live overlap, and recover stale leases deterministically |
| 2026-08-02 | The existing frontend lint baseline contains 254 unrelated findings | A global lint result cannot distinguish this feature from established debt | Require zero findings in new/isolated files, retain the global baseline result, and rely on full tests plus production build until the lint debt is handled separately |
| 2026-08-02 | An interrupted npm installation can leave valid package metadata with missing runtime entries | Vite may fail successively on unrelated packages despite unchanged lockfiles | Move the generated tree to a recoverable temporary path and rebuild it with `npm ci --include=dev` before diagnosing application code |

## 12. Implemented Validation Record

- Backend focused capability suites: 107 passing after final hardening.
- Backend complete suite: 1,696 passing, 27 skipped in the sandbox; the sole
  socket-restricted timeout test passed separately with localhost permission,
  for 1,697 effective passing tests.
- Frontend complete Vitest suite: 181 passing across 39 files.
- Locale validation: all Catalan, English, Spanish, and French catalogs pass.
- Production build: 7,604 modules transformed and optimized successfully.
- Browser E2E: alternate native backend/frontend loaded Settings, AI,
  Automations, and Runs & audit; the form, budgets, approval queue, durable jobs,
  and metadata-only audit were present and the browser console had zero errors.
