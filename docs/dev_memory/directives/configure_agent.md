# Directive: Configurar Agent Digital Brain

## Objectiu
Configurar i verificar l'agent multi-agent del Digital Brain.

## Arquitectura

```
┌─────────────────────────────────────────┐
│              SUPERVISOR                  │
│  (Ruta a l'agent apropiat)              │
└────────────┬────────────────────────────┘
             │
    ┌────────┼────────┬────────────┐
    ▼        ▼        ▼            ▼
┌──────┐ ┌──────┐ ┌─────────┐ ┌──────┐
│Coder │ │Brain │ │ General │ │FINISH│
└──────┘ └──────┘ └─────────┘ └──────┘
```

- **Coder**: Gestió de codi, git, sistema de fitxers
- **Brain**: Notion, n8n, memòria vectorial, directives
- **General**: Conversa casual

## Procediment

### 1. Iniciar Backend
```bash
cd monorepo/apps/digital-brain
./run_dev.sh  # o docker-compose up -d
```

### 2. Verificar Agent
```python
from backend.agent.factory import _get_hybrid_llm, build_graph
llm = _get_hybrid_llm()  # Hauria de dir "✅ Agent using Ollama (local)"
```

### 3. Verificar Memòria
```python
from backend.agent.memory import MemoryStore
store = MemoryStore()
store.add_memory("Test")
store.search_memory("Test")  # Hauria de retornar ["Test"]
```

## Restriccions / Edge Cases

### ⚠️ Ollama no disponible
- **Error**: "⚠️ Ollama not available"
- **Causa**: Ollama no està corrent
- **Solució**: `ollama serve` o verificar que l'app Ollama està oberta

### ⚠️ Memory not initialized
- **Error**: "Memory not initialized (No embeddings available)"
- **Causa**: sentence-transformers no instal·lat
- **Solució**: `pip install sentence-transformers`

### ⚠️ Tool calling limitat amb Ollama
- Models locals (llama3.2) tenen suport limitat de tool-calling
- Per tasques complexes amb moltes eines, pot ser millor usar Groq

## Fitxers Relacionats
- `backend/agent/factory.py` - Construcció del graf d'agents
- `backend/agent/memory.py` - Memòria vectorial
- `backend/agent/system_tools.py` - Eines del Coder
- `backend/agent/tools.py` - Eines MCP per Brain
