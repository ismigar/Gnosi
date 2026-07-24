# LangChain and LangGraph 1.x Migration

**Date:** 2026-06-24
**Status:** completed through dependency floors

## Diagnosis

The production Python environment already ran a compatible LangChain 1.x,
LangGraph 1.x, and checkpoint-sqlite 3.x stack. Old `>=0.x` requirement floors
did not pin the old versions; clean installs already resolved to modern
releases.

The real risk was allowing a future resolver to select incompatible pre-1.0
packages while the code used modern APIs such as `StateGraph`, `ToolNode`,
`START`, `END`, conditional edges, tool binding, and asynchronous SQLite
checkpoints.

## Action

Raise validated floors for:

- LangChain.
- LangGraph.
- LangChain OpenAI.
- LangGraph SQLite checkpoints.
- Ollama, Groq, and Hugging Face LangChain integrations.
- LangChain Anthropic, which is required by the existing Anthropic adapter.

No agent Python source migration was needed because runtime code was already
compatible.

## Verification

- Built representative graphs with tool nodes and conditional edges.
- Exercised `AsyncSqliteSaver` creation, compilation, streaming, and state
  retrieval.
- Constructed provider adapters and tools.
- Imported and compiled all live agent modules.
- Verified the backend mounted agent routes and remained healthy.

## Restrictions

- Do not lower core packages below the validated major versions.
- Keep provider integrations in the same compatible ecosystem generation.
- The SQLite checkpoint import path remains valid; do not change it without
  evidence.
- Dead experimental agent code is not part of the live migration.
- Install required adapters in the real venv before claiming that provider is
  operational.

## Dependency automation

Old Dependabot major-version ignore directives became obsolete. Remove those
repository-side ignore decisions so future compatible updates are proposed.

Always validate dependency changes against the actual native venv on the target
architecture.
