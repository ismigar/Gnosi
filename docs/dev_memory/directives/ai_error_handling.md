# Directiva: Gestió d'Errors i Fallback d'IA

## Context
Quan un proveïdor d'IA (com Groq) arriba al seu límit de taxa (rate limit), el backend pot retornar errors que el frontend ha de capturar graciosament.

## Procediment de Gestió d'Errors
1. **Detecció**: Capturar excepcions de LangChain/API al backend (`agent_routes.py`).
2. **Streaming d'Error**: Enviar un esdeveniment de tipus `error` amb un contingut (`content`) que expliqui el problema de forma humana (ex: "Has superat la quota de Groq").
3. **Fallback Automàtic**: Al `factory.py`, si el proveïdor principal falla en ser instanciat, intentar el següent proveïdor configurat que tingui clau d'API.

## UI/UX (Frontend)
- El component `AgentChat.jsx` ha de mostrar un missatge d'error clar.
- No s'han de mostrar bombolles de missatge buides mentre s'espera la resposta si sabem que hi ha hagut un error.

## Restriccions
- No intentar fer fallback a un mateix proveïdor amb el mateix model si l'error és de rate limit.

## Timeout REAL de les crides one-shot (`generate_text`)

**Problema (bug latent, arreglat):** `llm.invoke(msgs, config={"timeout": N})` NO aplica cap
límit. `"timeout"` no és clau de `RunnableConfig` de langchain (les vàlides: `tags`,
`metadata`, `callbacks`, `run_name`, `max_concurrency`, `recursion_limit`, `configurable`,
`run_id`); langchain l'ignora en silenci. Resultat: si el proveïdor es penja, `.invoke()`
bloqueja el fil indefinidament (greu al backend NATIU: satura el pool de `asyncio.to_thread`
→ event loop congelat, cf. `environment_integrity.md`).

**Regla:** el timeout s'aplica en CONSTRUIR el client (a `get_llm`), no a `.invoke()`.
- OpenAI-compatible (openai/deepseek/mistral/openrouter/groq-shim/generic/local/lmstudio):
  `ChatOpenAI(timeout=N, max_retries=0)`. `timeout` és àlies de `request_timeout` → arriba al
  client `httpx` de l'SDK `openai`.
- Ollama: `ChatOllama(client_kwargs={"timeout": N})`. **`ChatOllama` IGNORA `timeout=` directe**
  (`model_config extra="ignore"`) → el vell `ChatOllama(..., timeout=60)` era lletra morta.
- Anthropic: `ChatAnthropic(timeout=N, max_retries=0)` (àlies de `default_request_timeout`).
  Nota: `langchain-anthropic` pot NO estar instal·lat al venv Mac → aquesta branca retorna
  `None` i el flux degrada al fallback híbrid.

**`max_retries=0` a la ruta one-shot:** l'SDK `openai` reintenta 2x per defecte i el `timeout`
és PER-INTENT → sense desactivar-los, el sostre efectiu seria ~3×N. Amb `max_retries=0` el
`timeout` és un sostre real. El camí de l'AGENT (streaming) crida `get_llm` SENSE `timeout` →
manté reintents i cap límit dur (els torns d'agent poden ser llargs).

**Edge case documentat:** `httpx` aplica el timeout per-operació (connect/read/write), no com a
deadline total. Un servidor que degoteja bytes per sota del llindar podria allargar-se; per al
nostre model d'amenaça ("el proveïdor es penja" = 0 bytes) el read-timeout dispara bé.

**Degradació dels callers:** en superar el timeout, l'SDK llança la seva excepció
(`openai.APITimeoutError`, `httpx.TimeoutException`…), NO `RuntimeError`. Tots els callers ja
la capturen amb `except Exception` i degraden (text cru / placeholder / ToolMessage d'error).
`RuntimeError` es reserva per a "cap proveïdor disponible" (→ HTTP 503). A `/ai/generate` i
`/ai/correct` una excepció de timeout es mapeja a **504** amb missatge accionable.

## Restriccions (timeout)
- MAI passar `config={"timeout": ...}` a `.invoke()` — s'ignora. El timeout va al constructor.
- Provider-agnòstic amb `ThreadPoolExecutor`+`future.result(timeout)` DESCARTAT: deixa el fil
  HTTP corrent (fuga de fil/connexió) després del timeout — inacceptable al backend natiu de
  vida llarga. El timeout del client HTTP avorta la petició de veritat i allibera el fil.
