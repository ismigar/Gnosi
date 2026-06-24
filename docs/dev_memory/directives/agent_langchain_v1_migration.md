# Directiva: Migració de l'agent a langchain/langgraph 1.x

**Data:** 2026-06-24 · **Estat:** completada (canvi a `monorepo/apps/gnosi/requirements.txt`)

## Context

Dependabot va proposar 4 bumps MAJORS de l'stack d'IA, que es van **tancar**
amb `@dependabot ignore this major version` sota la premissa que "fusionar-los
trencaria l'agent en un `pip install` net":

| PR | Paquet | Bump |
|----|--------|------|
| #342 | langchain | 0.1 → 1.3 |
| #345 | langgraph-checkpoint-sqlite | 1.0 → 3.1 |
| #346 | langchain-openai | 0.0.5 → 1.2 |
| #347 | langgraph | 0.0.10 → 1.2 |

## Diagnòstic (la premissa era incorrecta)

El venv real de l'agent (`~/Projectes/monorepo/apps/gnosi/.venv`, py3.11, el
que serveix `uvicorn` a :5002) **JA tenia instal·lat l'stack objectiu**:
langchain 1.3.9, langgraph 1.2.5, langchain-openai 1.3.2,
langgraph-checkpoint-sqlite 3.1.0, langchain-core 1.4.8. El backend viu
arrencava i `/api/health` tornava 200 → tot el graf d'imports de l'agent
(`factory.py`, `agent_routes.py`, `memory.py`, `tools.py`, `system_tools.py`,
`generated_tools/*`) ja **carregava net sobre 1.x/3.x**.

Causa: els terres a `requirements.txt` eren `>=` amb valors antics
(`langgraph>=0.0.10`, `langchain>=0.1.0`, …). Com que són `>=`, un `pip install`
net **ja resolia a l'última (1.x)** — el codi mai no va córrer realment sobre
0.x. El codi de l'agent ja usa APIs modernes (`StateGraph`, `prebuilt.ToolNode`,
`START/END`, `add_conditional_edges`, `bind_tools`, `AsyncSqliteSaver`).

El PERILL real era el contrari: els terres `>=0.x` **permetien** que una
resolució futura caigués a pre-1.0 (langgraph 0.0.10 no té `prebuilt.ToolNode`
ni `START`; langchain-core 0.x és incompatible amb les integracions 1.x) → això
SÍ trencaria l'agent. Apujar els terres a 1.x **protegeix** la migració.

## Acció (única: terres de `requirements.txt`)

- `langgraph>=1.2.5`, `langchain>=1.3.9`, `langchain-openai>=1.3.2`,
  `langgraph-checkpoint-sqlite>=3.1.0` (terres = versions validades).
- Coherència de l'ecosistema 1.x (evitar integració 0.x sobre core 1.x):
  `langchain-ollama>=1.1.0`, `langchain-groq>=1.1.3`, `langchain-huggingface>=1.2.2`.
- **Afegit** `langchain-anthropic>=1.0`: `factory.py:205` fa
  `from langchain_anthropic import ChatAnthropic` i Anthropic surt a les llistes
  de selecció automàtica (`_resolve_auto_llm`), però el paquet NO hi era (només
  el SDK cru `anthropic>=0.20.0`, que no basta). Sense ell, el proveïdor Anthropic
  degrada a None silenciosament.
- NO s'ha tocat cap `.py`: el codi ja era compatible.

## Verificació feta (QA)

1. Proves dirigides de les APIs de més risc sobre el venv 1.x/3.x (10/11 OK):
   `StructuredTool.from_function(func=None, coroutine=…)` (la més arriscada),
   `AsyncSqliteSaver` + `from_conn_string`, `StateGraph`+`ToolNode`+
   `conditional_edges`+`compile()`, construcció de `ChatOpenAI`/`ChatOllama`,
   `@tool`, `Chroma`+`Document`, prompts i messages. (L'únic "fall" era
   `langchain_anthropic` no instal·lat → motiu de l'afegit.)
2. Camí runtime exacte d'`agent_routes.py`: `AsyncSqliteSaver.from_conn_string`
   (CM) → `compile(checkpointer)` → `astream(stream_mode="updates")` →
   `aget_state` amb persistència d'estat. **OK** sobre checkpoint-sqlite 3.x.
3. Backend viu a :5002 (mateix venv) sa: `server.py:268` munta `agent_routes`.
4. `py_compile` de tots els mòduls de l'agent amb el py3.11 del venv: OK.
5. El venv satisfà tots els nous terres (excepte `langchain-anthropic`, a instal·lar).

## Restriccions / Edge cases

- **NO baixar cap terra per sota de 1.x** (3.x per a checkpoint-sqlite). Faria
  resoldre a una versió incompatible amb core 1.x → trenca l'agent.
- El path d'import `langgraph.checkpoint.sqlite.aio.AsyncSqliteSaver` **NO va
  canviar** entre 1.0 i 3.x (verificat). No cal tocar-lo.
- `graph.py` (chatbot "Fase-1", `gpt-3.5-turbo`) és **codi mort** (ningú
  l'importa). Es deixa tal qual; compila bé. No forma part de l'agent viu.
- `langchain-anthropic` NO és al venv viu → per activar Anthropic ARA:
  `~/Projectes/monorepo/apps/gnosi/.venv/bin/pip install 'langchain-anthropic>=1.0'`.
  Sense això, degrada bé (fallback híbrid). No bloqueja la migració.

## Follow-ups (acció de l'usuari a GitHub)

- Els 4 PRs (#342/#345/#346/#347) queden **superats** per aquest canvi (fa el
  mateix bump + coherència, ja verificat) → no cal reobrir-los.
- Els `@dependabot ignore this major version` viuen a l'estat intern de
  Dependabot (NO a `.github/dependabot.yml`). Ara que adoptem 1.x/3.x, cal
  **`@dependabot unignore this major version`** (per langchain, langgraph,
  langchain-openai, langgraph-checkpoint-sqlite) en qualsevol PR de Dependabot
  d'aquests paquets, o Dependabot no proposarà futurs updates dins de 1.x/3.x.
