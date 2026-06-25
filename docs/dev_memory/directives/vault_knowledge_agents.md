# Directiva: Agents de coneixement sobre el Vault (ampliació de l'agent existent)

**Objectiu:** que els agents IA de Gnosi puguin **treballar amb les dades** (no només
cercar-les) i, via MCP, **connectar amb l'exterior** — començant pels casos que l'usuari
vol: proposar connexions entre notes, generar resums/fitxes Cornell de PDFs, curar el
vault, xat-RAG sobre el coneixement, i recerca externa → nota.

## Punt de partida REAL (no construïm de zero)

Gnosi JA TÉ un arnès d'agents madur. **Ampliem, no dupliquem.** Inventari verificat:

| Capacitat | On viu | Estat |
|---|---|---|
| Loop multi-agent (supervisor→coder/brain/general) | `backend/agent/factory.py` (~337-527) | ✅ |
| Crida LLM multi-proveïdor + `generate_text` | `backend/agent/factory.py` (139-331) | ✅ |
| **Client MCP** (tools externes → langchain) | `backend/mcp/client.py`, `backend/agent/tools.py` | ✅ |
| Auto-creació de tools (validator/sandbox/learning) | `backend/agent/generated_tools/` | ✅ |
| Memòria vectorial (Chroma) | `backend/agent/memory.py` | ✅ |
| Xat streaming SSE amb tool-calls | `backend/api/agent_routes.py` (`POST /api/chat`), `frontend/src/components/AgentChat.jsx` | ✅ |
| Persones/instruccions com a markdown | `backend/agent/instructions/*.md` | ✅ |
| Tools de **lectura** del vault | `system_tools.py`: `search_vault`, `get_vault_registry` | ✅ |
| **Tools d'ACCIÓ sobre el vault** (crear/editar/relacionar/llegir pàgina/PDF) | — | ❌ **EL FORAT** |
| Tools actuals d'acció | git, `apply_patch`, `run_tests`, `inspect_codebase` | ⚠️ centrades en CODI, no en coneixement |

**Diagnòstic:** l'agent "brain" pot CERCAR el vault però no pot ACTUAR-hi. Les úniques
tools d'escriptura són de programador. El que falta és el **cinturó d'eines de coneixement**.

## Fase 1 — Cinturó d'eines de coneixement (EL TOTXO)

Nou mòdul `backend/agent/vault_tools.py` amb `@tool` (langchain) que embolcallen l'API/serveis
de vault que JA existeixen (reusar la lògica de `vault_routes`, no reimplementar):

| Tool | Acció | Reusa |
|---|---|---|
| `read_page(id_or_title)` | cos + metadata d'una pàgina | `GET /pages/{id}` / page index |
| `read_pdf(path_or_asset)` | text d'un PDF d'`Assets/`/`Biblioteca/` | extractor PDF (materialitzar si OneDrive) |
| `create_page(title, content, table_id?, metadata?)` | crea pàgina/fila | lògica de `POST /pages` + `register_page_in_index` |
| `update_page(id, content?/metadata?, targeted_replacements?)` | edita | `PATCH /pages` (merge + reemplaçaments dirigits) |
| `get_relations(id)` | directes + inverses | `GET /pages/by-table` (font del backend) |
| `link_pages(from_id, to_id, field?)` | crea relació/wikilink | PATCH + `sync_inverse_relations` |
| `query_table(table_id, filters?)` | files d'una taula | `by-table` + apply_filter |
| `list_tables()` | catàleg de taules | `GET /tables` |
| `propose_links(id)` | (composta) cerca relacionades i SUGGEREIX `[[...]]` | search_vault + read_page |

**Registre:** afegir-les al conjunt de l'agent **brain** (`factory.py`, on es construeix
`brain_tools`). NO al coder. Mantenir el coder per a tasques de codi.

### Restriccions de seguretat (OBLIGATORI)
- Nivells de risc del validador existent: escriptures al vault = `LOCAL_WRITE` (no demanen
  aprovació); res no és `EXTERNAL_WRITE` excepte tools MCP que escriguin fora.
- **Mai escriure a notes reals durant QA**: l'autosave/collab persisteix per WebSocket
  (cf. [[feedback_collab_ws_bypasses_fetch_block]], [[feedback_vault_editor_qa_safety]]) →
  usar pàgines d'usar i llençar o un vault de proves a `/tmp`.
- `read_only`/derivats (formula/rollup, Creat/Editat per) → mai escriure'ls.
- Tota escriptura passa pel servei (estampat d'autoria, carpetes, índex) — no a disc cru.
- Confirmar accions destructives (esborrar/buidar) via la UI, mai dins una tool silenciosa
  (cf. [[feedback_destructive_action_confirm_accessibility]]).

## Fase 2 — Persones/skills de coneixement (prompts, no codi nou)

Cada "agent" que l'usuari vol és una **persona** (markdown a `backend/agent/instructions/`)
que orquestra el MATEIX cinturó d'eines. No calen nodes nous si el supervisor sap encaminar:

- **Curador**: detecta òrfenes/duplicats, suggereix tags, omple buits → `query_table`+`update_page`.
- **Connector** (el que l'usuari va afegir): `propose_links` sobre la pàgina activa.
- **Resumidor/Cornell**: `read_pdf`/`read_page` → `generate_text` (plantilla Cornell) → `create_page`.
- **Xat-RAG**: `search_vault` (ja hi és) + cites → resposta conversacional (ja és el xat actual).
- **Correu/agenda**: tools sobre Gmail/Google (ja connectats) — fase posterior.

**Context dinàmic:** injectar "pàgina/taula activa" al context del xat (avui hi ha `mentions`
però no auto-context) — passar `active_page_id` al `POST /api/chat` i exposar-lo a les tools.

## Component transversal — Router de models (data-driven + conscient de pressupost)

**Estat actual** (`agent/factory.py`): proveïdors configurables (`load_params().ai.providers`,
UI a Configuració › IA) + `_resolve_auto_llm` que tria per complexitat/disponibilitat. **Límit:**
els stacks de models són HARDCODED dins la funció i el router NO sap de tokens/cost/quota.

**Objectiu de l'usuari:** configurar tants proveïdors/models com vulgui (locals o no) i que
l'orquestrador triï per petició + tokens restants + cost + disponibilitat.

**1. Registry de models data-driven** (Configuració › IA, desat a config/secrets):
cada entrada = `{provider, model_id, endpoint?, is_local, enabled, priority, cost_in/out
(per 1k tok), context_window, tags[] (p.ex. code/vision/long-context/tools), monthly_quota?}`.
Afegir/treure models sense tocar codi. Substitueix els stacks hardcoded de `_resolve_auto_llm`.

**2. Router per política** (puntua candidats, no llista fixa):
- **Capacitat**: filtrar pels `tags` que la petició necessita (codi, visió, context llarg, tools).
- **Disponibilitat/salut**: reusar `_provider_is_available` + health (no triar un proveïdor 401/down).
- **Pressupost/tokens**: si la quota del proveïdor de pagament s'esgota o el cost estimat supera
  el sostre → **degradar a model més barat o LOCAL** (Ollama: cost 0 → preferit quan apreta).
- **Cost/qualitat**: a igualtat, el de millor relació segons complexitat estimada.

**3. Comptabilitat d'ús** (NOU — verificar si existeix): comptar tokens in/out per
proveïdor i període (taula/JSON a GNOSI_LOCAL_DATA) → alimenta "queden tokens". Per a models
locals, cost 0; per a quotes de free-tier, comptador mensual amb reset.

**On tocar:** `_resolve_auto_llm` → `route_model(request_features, registry, usage, budget)`;
el `llm_mode` del xat (`auto|manual|agent_default`) es manté (manual = força un model del registry).
Encaixa amb l'**escletxa oberta**: afegir un proveïdor/model local nou = una fila al registry.

## Fase 3 — Connexió exterior (reusar el client MCP que JA hi és)

- Registry de servidors MCP a Configuració (stdio/HTTP/OAuth) → `backend/mcp/client.py`.
- **Tanca el cercle amb l'importador de Notion**: configurar el **MCP allotjat de Notion**
  com a servidor → l'agent obté pàgines/BD/**vistes** sense l'API REST (Fase 2 de
  [[notion_api_importer]] feta "gratis" per aquí).
- Web/recerca: tool MCP o `WebFetch`-like per a l'agent "Investigador → nota".

## Escletxa oberta (objectius futurs sense redisseny) — requisit de l'usuari

Ja és estructural; només cal **no tancar-la**:
1. **Auto-tools** (`generated_tools/`): l'agent pot crear-se tools ndnoves dins el sandbox →
   capacitats que avui no imaginem entren sense tocar el core.
2. **MCP**: qualsevol servei extern futur = afegir un servidor MCP, zero codi.
3. **Registry de persones/skills**: les persones són markdown → afegir un agent = afegir un
   `.md` + (si cal) encaminament al supervisor. Mantenir-ho data-driven, no hardcoded.
4. Mantenir el cinturó d'eines **genèric** (read/write/relate/query), no fet a mida d'un sol
   cas → qualsevol agent nou el reutilitza.

## QA (obligatori)
1. **Tools**: tests del nucli amb un vault de proves a `/tmp` (cf.
   [[feedback_isolated_testclient_e2e]]); mai contra notes reals.
2. **E2E al xat**: obrir `AgentChat`, demanar "resumeix aquest PDF en una fitxa Cornell" i
   "proposa connexions per a aquesta nota", verificar tool_start/tool_end al stream i la
   pàgina creada (re-fetch + esborrar — cf. [[feedback_qa_verify_persistence]]).
3. **Stopping rule**: "no s'ha pogut provar" = no fet.

## Ordre d'execució
1. **Fase 1** (cinturó d'eines) — desbloqueja TOT. Primer agent demo: **Connector + Cornell/resum**.
2. Persones de coneixement (Fase 2) sobre el mateix cinturó.
3. Connexió exterior via MCP (Fase 3) — Notion-amb-vistes inclòs.
