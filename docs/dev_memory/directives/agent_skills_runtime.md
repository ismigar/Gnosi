# Directive: Agent Skills and Tool Governance

**Status:** Implementation in progress.
**Origin:** 2026-07-30.

## 1. Purpose

Gnosi agents must be composable profiles instead of receiving one hard-coded tool belt.
An agent owns identity, model, persona, context, and assigned skills. A skill describes
how to perform a reusable job and references registered tools. A tool is the only
executable unit and carries typed effects, permission requirements, and confirmation
policy. A plugin is a distribution and ownership boundary that may contribute agents,
skills, and tool adapters.

The system must keep these concepts separate:

- **Agent:** model, persona, context, context references, and skill assignments.
- **Skill:** declarative instructions plus stable tool references; never arbitrary code.
- **Tool:** typed executable capability with centrally enforced effects and policy.
- **Plugin:** declarative contribution owner and lifecycle boundary.
- **Service or script:** internal implementation that is invisible to agents unless a
  registered tool adapter exposes it.

## 2. Sources and ownership

The effective skill catalog combines:

- `core.*`: bundled by Gnosi; inspectable and assignable, but immutable.
- `plugin.<plugin-id>.*`: contributed by an enabled plugin; inspectable, assignable, and
  cloneable, but not directly editable or independently deletable.
- `user.*`: stored under `<vault>/.gnosi/agent/skills/`; fully editable and portable with
  the vault.

Only skills explicitly marked as agent-assignable appear in an agent's skill selector.
Existing pipeline packages may instead be actions, automations, developer procedures, or
infrastructure. A `SKILL.md` directory does not become executable or assignable merely by
existing.

Core and plugin definitions use stable namespaced IDs. User skills receive collision-safe
`user.*` IDs. Plugin manifests declare relative contribution files; the backend derives
and validates ownership so a plugin cannot impersonate core or another plugin.

## 3. Skill package contract

An assignable skill has human instructions and structured metadata:

- `SKILL.md`: reusable instructions and examples.
- `skill.yaml`: schema version, stable ID, version, name, description, origin, kind,
  activation policy, and tool IDs.
- optional `references/` and `assets/`.

Scripts inside a package are implementation or maintenance resources. They are never
loaded with `exec()` because a skill was assigned. User-created skills initially support
instructions and composition of already registered tools only.

Supported kinds are:

- `agent`: assignable runtime capability;
- `action`: explicit application action;
- `automation`: scheduled or event-driven workflow;
- `developer`: development or operational procedure.

Activation is either `always`, `automatic`, or `explicit`. Assigned skill summaries may
be visible to the model, but full instructions and tools are activated only for the
current turn. Missing dependencies degrade visibly and never grant a broader fallback.

## 4. Tool catalog and effects

Tools come from four governed sources:

- core mappings to explicit Python callables;
- plugin adapters, with third-party code restricted to the existing Node sandbox;
- MCP tools, subject to declared annotations and connector grants;
- generated tools, only after human approval of an immutable revision.

Every descriptor includes a stable ID, version, input/output schema where available,
origin, effects, minimum role, confirmation policy, and handler reference. Minimum effect
classes are:

- `read`;
- `local_write`;
- `external_write`;
- `destructive`;
- `code_execution`;
- `ai_cost`.

Risk and required authorization are derived from registered tools, not trusted from skill
text. Assigning a skill only makes its tools eligible. Effective execution is the
intersection of the agent assignment, skill activation, plugin availability, granted
permissions, user role, model tool support, and current-turn authorization.

Current-turn authorization must be evaluated immediately before every tool call. It must
never be captured in a cached graph or inferred only by a prompt. Destructive and external
writes require explicit confirmation. Reversible local writes require an explicit request.
Long or model-costing jobs require an explicit request or confirmation.

## 5. Agent runtime

The runtime resolves:

1. the agent profile and assigned skill IDs;
2. available descriptors from the effective catalog;
3. the skills relevant to the current message;
4. deterministic instruction fragments;
5. the exact deduplicated tool set;
6. the execution policy for the active user, vault, plugin grants, and turn.

Context references remain scoped to the selected agent and produce only the existing
containment-safe context readers. They are data sources, not skills or instructions.

The configured agent's persona applies to every response path. The legacy internal
Supervisor/Coder/Brain/General graph must not cause a specialist node to discard the
configured persona. During migration, a legacy compatibility skill bundle preserves
existing behavior. The final runtime routes skills, not hard-coded identities.

Graph caches include the agent revision and skill/tool catalog revision. Turn
authorization is request state, never cached closure state. Every response exposes
auditable skill and tool events without leaking secrets or raw untrusted source content.

## 6. Settings and APIs

Settings → AI contains Models, Agents, Skills, and Tools:

- Agents select assignable skills and show locked plugin-required assignments.
- Skills show origin, availability, effects, tools, and consuming agents.
- User skills support create, edit, validate, clone, and confirmed delete.
- Core/plugin skills support inspect, enable where optional, and clone.
- Tools show origin, effects, schema, status, consumers, and approval controls. They do
  not expose an unrestricted code editor.

AI resources use dedicated, revision-aware endpoints rather than replacing the complete
agent array through the generic configuration endpoint. Deleting an assigned user skill
returns the affected agents and requires an explicit atomic unassign-and-delete action.
Legacy configuration endpoints remain compatibility adapters for one release.

## 7. Plugin contribution lifecycle

Plugin API v2 adds declarative `contributes.skills`, `contributes.agents`, and optional
sandbox-backed agent tool descriptors. AI contributions require explicit permissions.
Installing a third-party plugin remains quarantined, disabled, and without grants.

The effective plugin agent is computed from immutable manifest defaults plus persisted
user overrides. Enabling reconciles contributions idempotently. Disabling suspends
contributed agents and skills and tears down runtimes, while preserving overrides,
settings, assignments, data, and knowledge. Reactivation restores them exactly.
Uninstallation revokes grants and removes active contributions, but keeps missing
references and archived overrides until a separate confirmed purge. Updates preserve
overrides by stable ID and require approval for new permissions.

Built-in plugins can be disabled but not uninstalled. No plugin directly edits the whole
AI configuration as part of lifecycle.

## 8. Brain migration

The existing `llm-wiki` agent keeps its stable ID and all user-edited fields. The plugin
contributes these initial skills:

- `plugin.llm-wiki.query`: Brain search plus evidence reading; automatic and read-only.
- `plugin.llm-wiki.process-source`: starts the existing durable ingest/reprocess job;
  local write plus AI cost, explicit activation.
- `plugin.llm-wiki.process-status`: reads durable job state.
- `plugin.llm-wiki.maintain`: deterministic lint/index maintenance; explicit activation,
  with semantic model work separately confirmed.

The adapters reuse current services and APIs. They do not duplicate page-writing logic or
grant generic page mutation tools. `query_wiki` is removed from the global agent tool pool.
Processing, provenance, reading-note, and permanent-note instructions belong to the
plugin skills instead of an inline persona. Existing Brain UI endpoints stay as adapters
during migration.

## 9. Existing asset migration

- Split the generated-tool registry from the skill catalog. Filesystem skills must never
  be converted into fake executable tool records.
- Keep human approval mandatory for generated tools. Approval alone does not make a tool
  globally available; a skill must reference it.
- Classify every existing `pipeline/skills` package. Add a structured descriptor only
  where it represents a real runtime capability. Developer, automation, and action
  packages remain outside the agent selector.
- Wrap existing `/api/vault/skills/*` actions only where an agent adapter has a clear
  typed contract and policy.
- Existing agents without a skill field temporarily receive
  `core.legacy-default-v1`; an idempotent migration then stores explicit assignments.
  An explicit empty assignment list means no skills.
- Preserve legacy fields and aliases during one compatibility release, then remove the
  hard-coded tool bundle and the special LLM Wiki agent lifecycle.

## 10. Restrictions and edge cases

- Do not allow skill instructions to weaken core safety or tool policy.
- Do not import third-party Python into the FastAPI process.
- Do not let plugin activation grant permissions.
- Do not delete missing or disabled plugin assignments silently.
- Do not make all pipeline `SKILL.md` files agent-assignable.
- Do not cache per-turn authorization in an agent graph.
- Do not expose a tool to an agent unless an assigned active skill references it.
- Do not let the supervisor route a profile with active governed tools to a
  tool-less worker. A non-legacy tool-backed runtime enters the tool-enabled
  specialist directly; the model still decides whether it needs to invoke an
  available tool.
- Do not let a model without tool calling silently claim tool execution.
- Do not infer tool compatibility only from the vault-local editable model
  registry. A secondary vault may legitimately have no `ai.models` rows while
  using a model selected from the global catalog. Resolve in this order:
  explicit profile override, matching editable registry row, global catalog;
  unknown models still fail closed.
- Do not store credentials in skill files or synchronized manifests.
- Do not reuse the existing developer Dashboard skill-directory deletion API for
  Settings → AI personal skills.
- Do not mark a tool-backed skill available from metadata alone: the effective tool
  registration must also provide a runtime adapter. Otherwise the UI could allow an
  assignment that the agent cannot execute.
- Plugin namespaces must accept the same safe IDs as the plugin system
  (`[a-z0-9][a-z0-9_-]{1,63}`), including underscores. Using a stricter catalog-only
  policy makes valid installed plugins impossible to contribute.
- Do not run backend tests without `GNOSI_LOCAL_DATA` in a native shell because
  current path discovery may fall back to deployment-only `/app/data`; point it
  at a writable local test directory instead.

## 11. Verification

Completion requires:

- unit tests for descriptor validation, namespacing, duplicate IDs, unavailable tools,
  CRUD, assignment conflicts, and idempotent migration;
- policy tests for every effect class and proof that authorization cannot survive a turn;
- exact tool binding tests showing unassigned tools are unavailable;
- plugin enable, update, disable, uninstall, re-enable, and override-preservation tests;
- Brain query, ingest start/status, maintenance, and permission tests;
- frontend build and component tests for Skills, Tools, assignments, incompatibility, and
  deletion conflicts;
- browser E2E from skill creation through assignment and an observable chat invocation;
- native backend verification and Docker-compatible path/config tests.
