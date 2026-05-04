# Directive: Configure Gnosi Agent

## Objective
Configure and verify the Gnosi multi-agent system.

## Architecture

```
┌─────────────────────────────────────────┐
│              SUPERVISOR                  │
│     (Routes to the appropriate agent)    │
└────────────┬────────────────────────────┘
             │
    ┌────────┼────────┬────────────┐
    ▼        ▼        ▼            ▼
┌──────┐ ┌──────┐ ┌─────────┐ ┌──────┐
│Coder │ │Brain │ │ General │ │FINISH│
└──────┘ └──────┘ └─────────┘ └──────┘
```

- **Coder**: Code management, git, filesystem.
- **Brain**: Notion import connector, n8n, vector memory, directives.
- **General**: Casual conversation.

## Procedure

### 1. Start Backend
```bash
cd monorepo/apps/gnosi
./run_dev.sh  # or docker-compose up -d
```

### 2. Verify Agent
```python
from backend.agent.factory import _get_hybrid_llm, build_graph
llm = _get_hybrid_llm()  # Should say "✅ Agent using Ollama (local)"
```

### 3. Verify Memory
```python
from backend.agent.memory import MemoryStore
store = MemoryStore()
store.add_memory("Test")
store.search_memory("Test")  # Should return ["Test"]
```

## Restrictions / Edge Cases

### ⚠️ Ollama not available
- **Error**: "⚠️ Ollama not available"
- **Cause**: Ollama is not running.
- **Solution**: Run `ollama serve` or verify that the Ollama app is open.

### ⚠️ Memory not initialized
- **Error**: "Memory not initialized (No embeddings available)"
- **Cause**: `sentence-transformers` not installed.
- **Solution**: `pip install sentence-transformers`.

### ⚠️ Limited Tool Calling with Ollama
- Local models (llama3.2) have limited tool-calling support.
- For complex tasks with many tools, using Groq may be preferred.

## Related Files
- `backend/agent/factory.py` - Construction of the agent graph.
- `backend/agent/memory.py` - Vector memory.
- `backend/agent/system_tools.py` - Coder tools.
- `backend/agent/tools.py` - MCP tools for Brain.
