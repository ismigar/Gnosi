---
status: implemented
last_verified: 2026-08-28
source_paths:
  - backend/domains/configuration/llm_wiki.py
  - backend/domains/llm_wiki
  - backend/services/llm_wiki_lint.py
  - backend/services/llm_wiki_pdf_annotations.py
  - backend/domains/agent
  - backend/domains/configuration/agent
  - backend/domains/configuration/ai
  - backend/agent
  - backend/agent/memory.py
  - backend/api/agent_routes.py
  - backend/api/agent_skills_routes.py
  - backend/api/ai_routes.py
  - backend/api/tools_routes.py
  - backend/services/artificial_analysis.py
  - frontend/src/components/AgentChat.jsx
  - frontend/src/components/AI
tests:
  - backend/tests/test_llm_wiki_extraction_domains.py
  - backend/tests/test_llm_wiki_lint.py
  - backend/tests/test_llm_wiki_pdf_annotations.py
  - backend/tests/test_llm_wiki_processing_domain_contract.py
  - backend/tests/test_llm_wiki_configuration_domain_contract.py
  - backend/tests/test_artificial_analysis.py
  - backend/tests/test_agent_chat_safety.py
  - backend/tests/test_pr6_agent_remaining_contract.py
  - backend/tests/test_agent_skill_runtime.py
  - backend/tests/test_generated_tool_validator.py
  - backend/tests/test_ai_model_registry_api.py
  - backend/tests/test_ai_content_routes.py
  - backend/tests/test_provider_delete.py
  - backend/tests/test_mcp_tool_routing_cache.py
  - backend/tests/test_agent_action_confirmations.py
  - backend/tests/test_agent_legacy_memory.py
  - tests/e2e/tests/e2e/ai-chat.spec.ts
---

# Agents de la IA, models, eines i habilitats

## Model de capacitat

El Gnomi separa models, agents, habilitats i eines:

- Model: una ruta del proveïdor amb capacitats, límits, metadades costdes, fiabilitat,
i credencials.
- Agent: instruccions, selecció de model, política de notes de memòria/ comprovació, i assignada
habilitats.
- Skill: un paquet de capacitat documentada que contribueix a instruccions i
Força les eines compatibles.
- Eina: una operació cal· lada classificada per efecte i origen.
- Font de context: S' ha afegit l' usuari- Vulta, taula, fitxer o material extern
a una conversa amb comportament de contenció i mida explícita.

El feed d'Artificial Analysis és una frontera tipada del servidor. Manté les
credencials privades, valida totes les pàgines, completa només metadades absents,
preserva mètriques verificades de la memòria cau i usa una còpia antiga o
models.dev amb procedència explícita quan el servei no respon.

## Inici i sol· licitud de flux

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

Les importacions històriques d'Agent continuen disponibles mitjançant façanes
de compatibilitat estretes, mentre que el paquet de domini gestiona el context,
les eines pròpies, l'evidència i les citacions, l'estat del flux, les
confirmacions, les sessions i les rutes. El catàleg i la governança d'agents
segueixen el mateix patró dins del domini de configuració, sense alterar l'ordre
de les rutes ni els identificadors d'operació.

L' encaminador de models resol combinacions de proveïdor/ model, límits de context, suport d' eines, despeses i política de reserva. S' obtindran les Credives del magatzem secret local o la migració d' entorn suportat, no es mostren al frontal. Les raons de suport per separat es registra de les respostes d' usuari per a distingir els operadors, el rebuig, les credencials del proveïdor, el context i l' eina en lacompatibilitat.

El client MCP per stdio valida els límits d'objectes JSON-RPC, tipa explícitament
les peticions asíncrones pendents i encamina les eines amb una memòria cau que
només es refresca quan hi ha una fallada de cerca. Els catàlegs malformats fallen
localment i no propaguen valors sense validar al runtime de l'agent.

La configuració d'IA manté credencials, tombstones de connexió, registre de
models, pressupost i ús en una façana de compatibilitat estrictament tipada. La
generació i correcció de l'editor viuen al domini de configuració AI, mentre que
la càrrega YAML validada i les respostes legacy explícites preserven exactament
els contractes HTTP i OpenAPI existents.

## Interfície de governança

Els descriptors d' eina declaren efectes read/ write/externals/destructiu. Genera eines que passen la validació AST amb base i s' executen en un entorn restringit. El validador bloqueja les capacitats perilloses com ara fitxers innecessiu escriu, accés d' entorn, accés dinàmic de traveral, i importacions insegures.

Accions requerides crear registres pendents amb confirmació. Confirmació de l' usuari, sessió, arguments, efecte i caducitat; acceptar una acció estable o alterat no s' autoritza d' una provocació diferent. El manteniment expirarà i elimina els registres independentment del tràfic de xat.

## Skils i connectors

Les habilitats en temps integrat viuen en `pipeline/skills/`Els paquets d' usuari i connectors es validen en un catàleg mentre es preserva l' origen, l' activació, la compatibilitat i els camps controlats contra l' usuari. La reconciliació del connector és idescriptible: deshabilitar un connector suspendre la seva contribució gestionada sense eliminar les sobreescriucions de l' usuari.

La façana legacy de memòria Chroma continua sent mandrosa i estrictament tipada
per compatibilitat d'importació. Importar-la només crea el directori configurat
i no carrega models d'embeddings. Sense embeddings, les lectures són buides i
les escriptures fallen explícitament; la memòria personal canònica continua al
servei SQLite governat i acotat del domini Agent.

## Context i memòria

L' estat de la conversa es pot trobar per agent i sessió. L' ordenació del missatge de la IU fa servir identificadors estables en comptes de l' hora d' arribada. Adjunts i fonts de context validant camins, mida, tipus de fitxer i àmbit de treball/ vviult. Les fonts externes grans usen representacions cercables en comptes d' injectar text sense límit en cada torn.

La navegació del Vault aporta context de pàgina, taula i vista activa només per
al torn actual. El servidor amplia un dashboard amb una sola vista incrustada a
la vista canònica de la taula, reaplica els filtres i l'ordenació i exposa una
consulta exacta i acotada amb recompte i paginació. Les lectures exactes de
pàgina i taula són crides d'eina creades pel servidor; després d'un resultat
complet, la síntesi s'executa sense eines perquè un model insistent no repeteixi
la crida fins al límit de recursió del graf.

La resta de torns de només lectura tenen un pressupost independent de tres
resultats: si el model continua demanant eines, la següent invocació de Cervell
rep les evidències acumulades sense eines vinculades i ha de sintetitzar la
resposta. Així, el límit de recursió del graf continua sent una xarxa de
seguretat final i no un control normal del flux.

El xat mesura cada resposta des de l'enviament de la petició fins al final del
flux. Un comptador viu de segons enters es reemplaça pel temps transcorregut
desat a la resposta completada. Cada missatge visible també permet rebobinar la
conversa: després de confirmar-ho, el servidor retalla el checkpoint canònic de
l'àmbit en el límit complet del torn i retorna la seva projecció pública. El
rebobinat només canvia la memòria de conversa; mai no es presenta com si hagués
revertit confirmacions completades o efectes externs.

Els registres editables de models s'hidraten des del catàleg canònic abans
d'arribar a Configuració o a l'encaminament d'execució. Les actualitzacions
parcials de pressupost i configuració es fusionen amb les capacitats, la finestra
de context, el cost i la qualitat existents. Els canvis de proveïdor o model
invaliden els grafs en memòria perquè el suport d'eines i les credencials siguin
efectius al torn següent. La capçalera del xat mostra el model seleccionat, el
nombre exacte d'eines i motius accionables per a qualsevol degradació.

## Configuració del LLM Wiki

`backend/domains/configuration/llm_wiki.py` valida la taula Brain, les fonts,
les dimensions categòriques, els camps de fitxer/URL, els valors fixos i les
relacions abans de mutar l'esquema. Després crea els rols i relacions canònics,
revalida els camps d'índex, desa atòmicament i actualitza les pàgines del sistema.
`backend/domains/configuration/llm_wiki_schema.py` gestiona separadament la
reparació idempotent dels camps Brain i la consolidació d'una relació canònica
per font, incloent-hi àlies, metadades de pàgina i vistes contextuals.
`backend/domains/configuration/llm_wiki_records.py` normalitza les notes
gestionades existents, les etiquetes de font i els títols localitzats dels índexs.
L'extracció es divideix entre `backend/domains/llm_wiki/documents.py`, que conté
els adaptadors tipats de documents i multimèdia, i `origins.py`, que conserva la
identitat, la deduplicació i els fragments deterministes. El servei històric es
manté com una façana de compatibilitat compacta.
El processament es divideix també en `planning.py` per als prompts, el parseig i
els plans fonamentats, `dimensions.py` per al mapatge fix/de font/per IA,
`ingestion.py` per al flux bloquejant, i `writing.py` per a la persistència
idempotent de notes de lectura.
`index_rendering.py` gestiona les pàgines d'índex de recurs, dimensió i general,
mentre que `search_index.py` gestiona els índexs reconstruïbles JSON, FTS5 i
vectorials. `backend/services/llm_wiki.py` i `llm_wiki_indices.py` continuen com
façanes de compatibilitat amb resolució tardana per conservar imports i punts de
substitució de plugins i proves.

El lint determinista del Brain separa comprovacions acotades de notes òrfenes,
revisions antigues, referències absents, claus duplicades, cites trencades,
reprocessament i deriva d'índexs. Manté el format de l'informe sense necessitar
cap proveïdor de models.

Les cites PDF fonamentades tenen una frontera de persistència determinista. La
geometria es resol reutilitzant un document per adjunt, els ressaltats gestionats
s'actualitzen en una transacció, les anotacions manuals es preserven i només
s'eliminen entrades obsoletes gestionades per Gnosi.

## Ha fallat i seguretat envaris

- El proveïdor no fa ruta en silenci a una ruta més cara o menys privada
model fora de la política configurada.
- Una eina no disponible al model/ es pot invocar pel nom
Sol.
- Els efectes obsolets o externs requereixen la seva política proposada.
- El codi generat no pot accedir als secrets o a l' estat del sistema de fitxers sense restriccions.
- Un ha fallat el servidor MCP no elimina servidors sans del catàleg.
- No s' ha presentat cap sortida de model parcial com una acció confirmada completada.
- Els missatges de l' agent estan aïllats per l' agent i la sessió a través de les tornades.

## Concentrat de verificació

Executa model rout, esborrat del proveïdor, fiabilitat, temps d' espera, MCP reintentar i resicionar, catàleg de habilitat/runtime/API, validació d' eines generada, contenidor de context, confirmació/expiry, ordenació de xat, i xat del navegador fluxos.
