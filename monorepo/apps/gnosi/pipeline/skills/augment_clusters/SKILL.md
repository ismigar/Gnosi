# Directive: Hybrid AI System (Ollama + Groq)

## Objective
Configure and maintain the hybrid AI system that uses Ollama (local) as primary and Groq (cloud) as fallback.

## Context
Gnosi uses AI for:
1. **Brain proposals**: Canonical connection analysis through `backend/services/llm_wiki_suggestions.py`
2. **Agent**: Multi-agent chat with tools (backend/agent/)

## Procedure

### 1. Verify Ollama
```bash
ollama --version
ollama run llama3.2 "Hello"  # Quick test
```

### 2. Pipeline Configuration
File: `config/params.yaml`
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

### 3. Agent Configuration
File: `backend/agent/factory.py`
- `_get_hybrid_llm()`: Tries Ollama → Groq → OpenAI (order of preference)

File: `backend/agent/memory.py`
- Uses local HuggingFace embeddings (`all-MiniLM-L6-v2`)

## Restrictions / Edge Cases

### ⚠️ Ollama Timeouts
- **Problem**: Ollama can timeout with long notes (>2000 chars)
- **Solution**: The system truncates the content and uses Groq as fallback
- **Current Timeout**: 60 seconds for Ollama, 300 for Groq

### ⚠️ Groq Limits (Free Tier)
- **Daily Limit**: 100,000 tokens/day
- **Per-minute Limit**: 12,000 tokens
- **Solution**: Run pipeline on consecutive days to process all notes

### ⚠️ Slow First Execution
- Ollama takes ~10s to load the model the first time
- HuggingFace downloads the embeddings model (~90MB) the first time

## Verification
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

## Related Files
- `pipeline/ai_client.py` - Multi-provider hybrid client
- `pipeline/utils/ai_analysis_cache.py` - Analyzed notes cache
- `backend/agent/factory.py` - Agent factory with hybrid LLM
- `backend/agent/memory.py` - Vector memory with local embeddings
