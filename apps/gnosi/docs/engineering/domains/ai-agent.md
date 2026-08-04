---
status: implemented
last_verified: 2026-08-02
source_paths:
  - backend/agent
  - backend/api/agent_routes.py
  - backend/api/agent_skills_routes.py
  - backend/api/ai_routes.py
  - backend/api/tools_routes.py
  - frontend/src/components/AgentChat.jsx
  - frontend/src/components/AI
tests:
  - backend/tests/test_agent_chat_safety.py
  - backend/tests/test_agent_skill_runtime.py
  - backend/tests/test_generated_tool_validator.py
  - backend/tests/test_agent_action_confirmations.py
  - e2e/tests/e2e/ai-chat.spec.ts
---

# AI agents, models, tools, and skills

## Capability model

Gnosi separates models, agents, skills, and tools:

- Model: a provider route with capabilities, limits, cost metadata, reliability,
  and credentials.
- Agent: instructions, model selection, memory/checkpoint policy, and assigned
  skills.
- Skill: a documented capability package that contributes instructions and
  constrains compatible tools.
- Tool: a callable operation classified by effect and origin.
- Context source: user-selected Vault, table, file, or external material added
  to a conversation with explicit containment and size behavior.

## Startup and request flow

```mermaid
sequenceDiagram
    participant Start as App lifespan
    participant MCP as MCP clients
    participant Catalog as Skill and tool catalog
    participant Graph as LangGraph workflow
    participant Chat as Chat endpoint
    participant Model as Selected model
    Start->>MCP: Connect and discover tools
    Start->>Catalog: Reconcile built-in, user, generated, and plugin entries
    Catalog->>Graph: Build allowed capability set
    Chat->>Graph: Message, agent, session, attachments, context
    Graph->>Model: Route prompt/tool cycle
    Graph->>Catalog: Validate tool effect and confirmation
    Graph-->>Chat: Ordered events and final response
```

The model router resolves provider/model combinations, context limits, tool
support, spend caps, and fallback policy. Credentials are obtained from local
secret storage or supported environment migration, not exposed to the
frontend. Failure reasons are recorded separately from user-facing responses so
operators can distinguish timeout, provider rejection, invalid credentials,
context overflow, and tool incompatibility.

## Tool governance

Tool descriptors declare read/write/external/destructive effects. Generated
tools pass AST-based validation and execute in a restricted environment. The
validator blocks dangerous capabilities such as unrestricted file writes,
environment access, dynamic dunder traversal, and unsafe imports.

Actions requiring confirmation create durable pending records. Confirmation
binds the user, session, tool, arguments, effect, and expiry; accepting a stale
or altered action does not authorize a different invocation. Maintenance
expires and removes records independently of chat traffic.

## Skills and plugins

Built-in runtime skills live in `pipeline/skills/`. User and plugin packages are
validated into a catalog while preserving origin, activation, compatibility,
and managed-versus-user-owned fields. Plugin reconciliation is idempotent:
disabling a plugin suspends its managed contribution without deleting user
overrides.

## Context and memory

Conversation state is scoped by agent and session. UI message ordering uses
stable identifiers rather than arrival time alone. Attachments and context
sources validate paths, size, file type, and workspace/vault scope. Large
external sources use searchable representations instead of injecting unlimited
raw text into every turn.

## Failure and safety invariants

- Provider failure does not silently route to a more expensive or less private
  model outside the configured policy.
- A tool unavailable to the selected model/skill cannot be invoked by name
  alone.
- Destructive or external effects require their declared policy.
- Generated code cannot access secrets or unrestricted filesystem state.
- One failed MCP server does not remove healthy servers from the catalog.
- Partial model output is not presented as a completed confirmed action.
- Agent messages remain isolated by agent and session across reloads.

## Verification focus

Run model routing, provider deletion, reliability, timeouts, MCP retry and
resilience, skill catalog/runtime/API, generated-tool validation, context
containment, confirmation race/expiry, chat ordering, and browser chat flows.
