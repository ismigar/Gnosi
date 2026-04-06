# Directive: Executar Pipeline de Connexions

## Objectiu
Executar el pipeline que analitza notes de Notion i suggereix connexions usant tags i AI.

## Procediment

### 1. Prerequisits
```bash
# Verificar Ollama està corrent
ollama list

# Verificar variables d'entorn
cat .env_shared | grep HF_API_KEY
```

### 2. Execució
```bash
cd monorepo/apps/digital-brain
python3 -c "from pipeline.skills.suggest_connections_digital_brain import process; process()"
```

### 3. Monitoritzar Progrés
El pipeline mostra:
- `[n/218] 📖 Títol de la nota...` - Progrés
- `✓ Found X valid connections [ollama|groq|cache]` - Font de l'anàlisi
- `⏱️ ollama timeout (60s), will try groq` - Fallback activat

## Restriccions / Edge Cases

### ⚠️ Rate Limit Groq
- **Error**: `AI error 429: Rate limit reached`
- **Causa**: S'ha arribat al límit diari de 100k tokens
- **Solució**: Esperar fins demà. Les notes processades estan al cache i no es tornaran a processar.

### ⚠️ Notes al Cache vs Notes Noves
- Notes ja analitzades mostren `[cache]` - instantànies
- Notes noves usen `[ollama]` o `[groq]` - més lentes

### ⚠️ Invalid IDs Skipped
- **Warning**: `Invalid ID skipped: xxx`
- **Causa**: IDs de Notion que ja no existeixen o estan mal formats
- **Acció**: No cal fer res, el pipeline continua

## Outputs
- `out/suggestions.json` - Connexions trobades
- `out/sigma_graph.json` - Graf per a visualització
- `out/ai_cache.json` - Cache de respostes AI
- `out/ai_analysis_cache.json` - Cache de notes analitzades

## Fitxers Relacionats
- `pipeline/skills/suggest_connections_digital_brain.py` - Script principal
- `config/params.yaml` - Configuració AI i colors
