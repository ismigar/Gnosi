# Directive: Sistema Híbrid AI (Ollama + Groq)

## Objectiu
Configurar i mantenir el sistema híbrid d'AI que usa Ollama (local) com a primari i Groq (cloud) com a fallback.

## Context
El Digital Brain utilitza AI per:
1. **Pipeline**: Suggerir connexions entre notes (suggest_connections_digital_brain.py)
2. **Agent**: Xat multi-agent amb eines (backend/agent/)

## Procediment

### 1. Verificar Ollama
```bash
ollama --version
ollama run llama3.2 "Hola"  # Test ràpid
```

### 2. Configuració Pipeline
Fitxer: `config/params.yaml`
```yaml
ai:
  primary_provider: ollama
  fallback_provider: groq
  providers:
    ollama:
      model_name: llama3.2
      model_url: "http://localhost:11434/v1/chat/completions"
      timeout: 60
      max_content_chars: 2000
    groq:
      model_name: llama-3.3-70b-versatile
      model_url: "https://api.groq.com/openai/v1/chat/completions"
      timeout: 300
```

### 3. Configuració Agent
Fitxer: `backend/agent/factory.py`
- `_get_hybrid_llm()`: Prova Ollama → Groq → OpenAI (ordre de preferència)

Fitxer: `backend/agent/memory.py`
- Usa HuggingFace embeddings locals (`all-MiniLM-L6-v2`)

## Restriccions / Edge Cases

### ⚠️ Ollama Timeouts
- **Problema**: Ollama pot fer timeout amb notes llargues (>2000 chars)
- **Solució**: El sistema trunca el contingut i usa Groq com a fallback
- **Timeout actual**: 60 segons per Ollama, 300 per Groq

### ⚠️ Límits Groq (Free Tier)
- **Límit diari**: 100,000 tokens/dia
- **Límit per minut**: 12,000 tokens
- **Solució**: Executar pipeline en dies consecutius per processar totes les notes

### ⚠️ Primera execució lenta
- Ollama triga ~10s a carregar el model la primera vegada
- HuggingFace descarrega el model d'embeddings (~90MB) la primera vegada

## Verificació
```python
# Test pipeline
from pipeline.ai_client import get_available_providers
print(get_available_providers())  # {'ollama': True, 'groq': True}

# Test agent
from backend.agent.factory import _get_hybrid_llm
llm = _get_hybrid_llm()  # ✅ Agent using Ollama (local)

# Test memory
from backend.agent.memory import MemoryStore
store = MemoryStore()  # ✅ Memory using HuggingFace embeddings (local)
```

## Fitxers Relacionats
- `pipeline/ai_client.py` - Client híbrid multi-proveïdor
- `pipeline/utils/ai_analysis_cache.py` - Cache de notes analitzades
- `backend/agent/factory.py` - Factory de l'agent amb LLM híbrid
- `backend/agent/memory.py` - Memòria vectorial amb embeddings locals
