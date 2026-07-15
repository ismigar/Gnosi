# Directiva: LLM Wiki — el «Cervell» de Gnosi

**Estat:** F0–F4 FET (branca `feat/llm-wiki-cervell`, sense commit). **Origen:** 2026-07-14, Ismael comparteix el gist
«LLM Wiki» de Karpathy (https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
i demana adaptar-lo a Gnosi.

## 1. Idea

Karpathy proposa que un LLM **construeixi i mantingui incrementalment** un wiki
markdown persistent (entitats, conceptes, resums, índex, log) a partir de fonts
crudes immutables, en comptes de re-derivar el coneixement a cada consulta (RAG).
El coneixement es **compila un cop i s'acumula**. Tres operacions: **Ingest**
(processar una font → tocar 10-15 pàgines), **Query** (respondre llegint el wiki),
**Lint** (detectar contradiccions, pàgines òrfenes, enllaços trencats).

## 2. Mapeig a Gnosi (què ja existeix)

| Karpathy | Gnosi |
|---|---|
| `raw/` fonts immutables | Taula **Recursos** (designació a Settings: `reference_table_config.py`, `/api/vault/reference-table`) |
| `wiki/` pàgines | Taula **Cervell** (nova designació per-vault): files `.md` amb frontmatter = propietats |
| `[[wikilinks]]` + cross-refs | Wikilinks natius `[[Títol\|id]]` + propietats `relation`; el graf ja separa `link` vs `relation` (`graph_service.py`) |
| `index.md` | La taula **és** l'índex (vistes/filtres de BD com a Dataview natiu) |
| `log.md` | Pàgina «Registre» a Cervell + historial de versions per pàgina (`/pages/{id}/history`) |
| `CLAUDE.md` (schema) | Pàgina «Esquema del Cervell», editable, injectada com a system prompt (co-evoluciona) |
| Ingest | Botó **«Processar recurs»** per fila de Recursos (via `action_rules`) |
| Query | Tool de l'agent de xat (LangGraph) que llegeix el Cervell |
| Lint | Tasca del scheduler (APScheduler) + botó manual |

## 3. Decisions de disseny

- **Designació per-vault** (NO repetir el gotcha de Recursos, global per instal·lació
  a `pipeline/skills/zotero_sync/zotero_db_config.json`): la del Cervell viu a
  `<vault>/.gnosi/llm_wiki.json` (`llm_wiki_config.py`) → sincronitza per OneDrive.
- **Built-in v1, no plugin v2 de tercers**: els plugins v2 NO poden pintar UI en
  superfícies existents (només comandes de paleta headless). El botó, els Settings i
  el lint es gategen amb `isPluginEnabled('llm-wiki')` del registre v1 (`registry.js`).
  Emetre un event `llm-wiki:ingested` al bus perquè plugins v2 hi puguin reaccionar.
- **Botó «Processar recurs»** (REFINAT a F2, autocorrecció): NO passa per la maquinària
  d'`action_rules` (que gira al voltant del rol `status` de publicació de Recursos i
  els catàlegs d'opcions; overload confús). En comptes d'això, patró Drupal/XXSS de
  **columna de sistema visible**: designar un Cervell afegeix una columna `date`
  **`Processat pel Cervell`** a la taula Recursos (`ensure_llm_wiki_column`). Aquesta
  columna és alhora el senyal del qual el frontend deriva el botó (`isLlmWikiTable`) i
  l'estat «només un cop».
- **«Només un cop»**: (1) el candau del job en curs (`is_running`) evita clics dobles /
  concurrència; (2) l'endpoint retorna **409** si la columna `Processat pel Cervell` té
  data, tret que `force=true`. Una data visible que l'usuari esborri deliberadament és
  re-procés explícit (no accidental) → n'hi ha prou amb la columna, sense sidecar. El
  re-procés automàtic per «font modificada» el proposarà el lint (F3), mai silenciós.
- **Tipus de nota generada = `lectura`** (`note_type: lectura` al frontmatter →
  `kind=reading` a `graph_service.py:67`). Són notes de lectura, com al gist.
- **Cites estil NotebookLM**: cada nota del Cervell enllaça al **punt concret** de la
  cita dins el document font (pàgina/posició del PDF via el lector Zotero vendoritzat,
  o passatge ancorat en article/URL). Mecanisme concret pendent d'anàlisi (veure §5).

## 3-bis. Fusió Zettelkasten × LLM Wiki (2026-07-15, decisions d'Ismael)

Context personal important: Ismael farà servir el Cervell per a **aprenentatge, recerca i
generació de contingut**, i té **mobilitat reduïda** (escriure fitxes a mà és costós).
El contracte ètic del sistema: **la IA fa la feina mecànica; l'usuari conserva la feina
cognitiva** (que és on passa l'aprenentatge), amb interaccions d'un clic o dictat.

| Capa | Qui | Què |
|---|---|---|
| Recursos | Usuari | Tria què entra (curadoria = direcció de l'aprenentatge) |
| Notes de lectura (`note_type: lectura`) | IA sencera | 1 recurs → N notes en ordre (`Posició`), **cada nota pertany EXACTAMENT a UN recurs** (`Fonts` many-to-one; guard dur a `_apply_plan`: update només com a relectura de la mateixa font). L'usuari les llegeix i marca `verificat` |
| Notes permanents (`note_type: permanent`) | IA proposa, usuari decideix | La IA detecta lectures de fonts DIFERENTS que parlen del mateix i encua un suggeriment; l'usuari accepta/edita/rebutja. **Cap permanent es crea sense confirmació humana** |

Decisions (AskUserQuestion 2026-07-15): suggeriments **després de cada ingesta I al lint**;
cada suggeriment porta **esborrany editable encapçalat per la pregunta que la nota respon**
(+ per què connecten, perquè decidir llegint sigui el repàs actiu); revisió a **panel («Bústia
del Cervell») + aristes suggestion al graf**.

Implementació: `llm_wiki_suggestions.py` (cua per-vault `.gnosi/llm_wiki_suggestions.json`,
validació: grups ≥2 membres de ≥2 fonts diferents; mirall al `suggestions.json` del graf amb
marca `llm_wiki`; `accept_suggestion` és l'ÚNIC camí que escriu una permanent: `note_type:
permanent`, `Tipus: síntesi`, `Estat: verificat`, `Basada en` → notes de lectura, pregunta com
a blockquote + esborrany). Endpoints: `GET /llm-wiki/suggestions`, `POST .../{id}/accept`
(títol/esborrany editats opcionals), `POST .../{id}/reject`; el lint accepta `?suggest=false`.
Frontend: `BrainInbox.jsx` (botó amb comptador al header de la taula Cervell, gating
`brainTableId` com el de References) + comptador al panel del plugin.

El mecanisme `suggestions` antic del graf NOMÉS suggeria enllaços i el seu accept està mort
(«SuggestionHandler not available») — no serveix per a permanents; el nostre l'usa només com
a capa visual.

## 4. Esquema llavor de la taula Cervell (`_BRAIN_SCHEMA`)

Anàleg a `_REFERENCE_SCHEMA`. Es sembra en designar/crear la taula:

- `Títol` (title)
- `Tipus` (select: entitat / concepte / resum / síntesi) — categoria de pàgina wiki
- `Fonts` (relation → taula Recursos, **many-to-one**: una nota de lectura pertany a UN recurs)
- `Posició` (number) — **ordre d'aparició** de la idea dins la SEVA font (ordinal 1-based que
  assigna la ingesta; el prompt exigeix llistar les notes en ordre d'aparició). Substitueix
  el camp «posició = capítol» que assumia 1 capítol = 1 idea: un capítol pot donar diverses
  idees. Ús: filtrar/agrupar per `Fonts` + ordenar per `Posició` = lectura seqüencial del
  recurs. (L'antic límit «nota enriquida per una 2a font» ja no existeix: les notes de
  lectura són d'una sola font per disseny — §3-bis.)
- `Basada en` (relation → la MATEIXA taula Cervell, many-to-many) — les permanents apunten
  a les notes de lectura que sintetitzen
- `Estat de verificació` (select: verificat / provisional / contradictori)
- `Última revisió` (date)
- `Tags` (multi_select)

Les notes generades porten a més `note_type: lectura` al frontmatter i, quan escaigui,
cites amb àncora a la font (§5). Gotchas d'implantació: `ensure_brain_table_schema` també
REPARA les relacions de columnes pre-existents (cardinalitat/target — el PATCH de propietats
només accepta name/type/config); i `_ensure_default_db_group` garanteix l'entrada
`gnosi_vault_db` a `registry.databases` amb `folder: "BD"` (convenció del clon) perquè la
taula surti al sidebar — NO usar el bootstrap global desactivat, que amb `Databases/Gnosi`
MOURIA la resolució de carpetes de les taules existents.

## 5. Cites amb àncora a la font (NotebookLM-style)

**FET a F2 (captura + render):** cada nota guarda les cites com a fragment verbatim +
localitzador (`p. 12`, secció…) i les renderitza en una secció «### Cites» amb blockquote
+ enllaç `[[Font|id]]` al recurs. Així la nota SEMPRE torna a la font.

**FET (el salt exacte al PDF):** clicar una cita obre el PDF del recurs a la pàgina
concreta. Cadena cablejada (API confirmada: el bundle Zotero exposa
`reader.navigate({pageNumber:"N"})`, 1-based):
- Cita al `.md`: `[p. N](gnosi-cite:?res=<id>&page=N)` (a `_render_citations`, pàgina
  extreta del localitzador amb `_parse_page`).
- `vaultMarkdownUtils.js`: sentinel `CITE_HREF_SENTINEL='gnosi-cite:'` + passa el
  `wikilinkUrlTransform`. `VaultMarkdown.jsx`: branch al render `a:` → `openCitation`.
- `fileResource.js`: `openCitation(res,page)` fa fetch del recurs, troba l'adjunt document
  (`findDocAttachment`) i crida `openFileResource(src,{location:{pageNumber}})`; aquest
  afegeix `location` al `gnosi:open-pdf` i a la query `/vault/pdf?...&page=N`.
- `VaultDashboard.jsx`: passa `location` del detall al tab i a `ZoteroReaderTab`.
- `ZoteroReaderTab.jsx`: `location` al payload `init` + postMessage `navigate` per a salts
  posteriors; el wrapper `/vault/pdf` llegeix `?page=`.
- `public/zotero-reader/host.html`: `init` navega si hi ha `location`; handler `navigate`.
Verificat: build + `_parse_page`/`_render_citations` (unit). PENDENT: prova en viu del
salt (cal un PDF real adjunt + navegador).

## 6. Fases

- **F0** — aquesta directiva. ✅
- **F1** — designació Cervell a Settings (per-vault) + taula llavor + toggle built-in `llm-wiki`. ✅
- **F2** — acció «Processar recurs» + motor d'ingesta. ✅ (núcleo). Fet:
  - `backend/services/llm_wiki.py`: lectura de font (PDF/URL/cos), plan LLM (`generate_text`),
    `_apply_plan` (crea/enriqueix notes via `save_page_md`, `note_type: lectura`, relació
    Fonts→Recursos, cites), job en background (patró `reader.py`: status dict per recurs +
    thread daemon + polling), event `llm-wiki:ingested`.
  - `vault_routes.py`: `ensure_llm_wiki_column`, `mark_resource_processed`, endpoints
    `POST /api/vault/llm-wiki/process` (+ guard 409 «només un cop») i `GET .../status/{id}`.
  - Frontend: botó a `VaultTable.jsx` (gate per columna `Processat pel Cervell`) +
    `ProcessResourceModal.jsx` (dispara + polling + fases) + i18n 4 locales.
  - Verificat: endpoints (404/idle/409), job live (reading→planning→error capturat),
    funcions pures (parse/cites/`note_type`/Fonts). **L'ingest LLM real bloquejat pel
    key d'API invàlid en aquest Mac** (secrets no sincronitzen; no és bug de codi).
  - Salt exacte al PDF de la cita: ✅ (§5).
- **F3** — Lint ✅: `backend/services/llm_wiki_lint.py` (checks DETERMINISTES, sense LLM:
  òrfenes, obsoletes per «Última revisió», referències creuades que falten, recursos
  modificats després de processar-se) + endpoint `GET /api/vault/llm-wiki/lint` + botó
  «Revisar el Cervell» al panel de Configuració (`LlmWikiConfig`) amb resum de comptes +
  i18n. Verificat: endpoint (Cervell buit → 0) + lògica de detecció (unit amb notes
  sintètiques). PENDENT (capa futura): checks amb LLM (contradiccions, buits de dades) que
  degraden si no hi ha proveïdor; accions de reparació (crear enllaç, reprocessar) des de
  l'informe (ara només llista).
- **F6 (FETA 2026-07-15) — Edició accessible de la Bústia.** Context: Ismael té mobilitat reduïda
  i **disàrtria** (pronúncia variable: cap ASR convencional l'entén de forma fiable — ho ha
  provat; «falta un component d'intuïció»). Disseny en 3 nivells, del més robust al més
  ambiciós:
  1. **Edició per tria (zero teclat, zero veu):** botó «Reformula» a cada suggeriment que
     genera 2-3 variants del esborrany (més curt / més formal / més matisat) per triar amb
     un clic. També «matisos» predefinits seleccionables (p. ex. «això és una hipòtesi, no
     un fet», «afegeix el contraargument»). Probablement el guany més gran pel cost.
  2. **Dictat amb intuïció:** Whisper local (ja present per a actes) + **correcció LLM
     contextual**: el corrector NO neteja fonemes, rep la pregunta + esborrany + títols de
     les notes membres i reconstrueix la intenció («¿Volies dir…?» amb confirmació d'un
     clic, mai s'aplica en cru). El domini acotat de la Bústia fa viable el que un dictat
     lliure no aconsegueix.
  3. **Glossari personal que aprèn:** cada correcció confirmada per Ismael alimenta un
     glossari per-vault (transcripció errònia habitual → terme volgut) que s'injecta al
     prompt del corrector — el «component d'intuïció» materialitzat i creixent. (Futur més
     enllà: fine-tuning de Whisper amb la seva veu, tipus Speech Accessibility Project —
     pesat per a un Mac Intel, no és el primer pas.)
  Regla de disseny transversal: tota entrada (veu o tria) es mostra com a PROPOSTA i es
  confirma amb un clic — mateixa ètica que la resta del Cervell.
  Implementació: `backend/services/llm_wiki_assist.py` (`reformulate` amb labels
  Més concisa/Més matisada/Amb contraargument; `correct_dictation` amb context de la
  sugerència + glossari, degrada a transcripció crua amb `corrected:false` sense proveïdor;
  glossari per-vault `.gnosi/llm_wiki_glossary.json`, dedupe per `heard`, cap 100).
  Endpoints: `POST .../suggestions/{id}/reformulate` (503 amb missatge clar si la IA falla,
  incloent claus invàlides), `POST .../suggestions/{id}/dictate` (UploadFile webm →
  faster-whisper → correcció; 503 si whisper no hi és), `POST /llm-wiki/glossary`.
  Frontend a `BrainInbox.jsx`: botons «Reformula» (variants per triar) i «Dicta»
  (MediaRecorder → proposta «He sentit / Volies dir» → Afegeix/Substitueix/Descarta;
  en aplicar una correcció real s'alimenta el glossari). Verificat: unit (glossari, parse,
  degradació, injecció del glossari al prompt), endpoints (404/503/glossari E2E), build.
  PENDENT en viu: reformulate/dictate reals (key d'API + model whisper).
- **F4** — operació «Query» ✅: tool `query_wiki` a `backend/agent/vault_tools.py`
  (dins `VAULT_KNOWLEDGE_TOOLS` → enllaçat a l'agent «brain» a `factory.py`). Llegeix la
  taula Cervell, puntua les notes per solapament de tokens amb la pregunta (`_tokenize`,
  com `rank_link_candidates`) i retorna títol+tipus+extracte+Fonts perquè l'agent
  sintetitzi amb cites SENSE re-fer RAG sobre les fonts crudes. Event `llm-wiki:ingested`
  ja s'emet a la ingesta (F2) per a plugins v2. Verificat: compila, registrat, backend
  arrenca sa. PENDENT: prova en viu (l'agent cridant el tool) bloquejada pel key d'API.
  Futur: rankejar amb embeddings (Chroma) en comptes de tokens; opció de desar la resposta
  com a nova nota del Cervell (Karpathy: «file good answers back»).

## 7. Restriccions / edge cases (s'ampliarà amb el que s'aprengui)

- **Backend natiu SENSE --reload**: endpoints nous no s'apliquen fins
  `launchctl kickstart -k gui/$UID/com.gnosi.backend`. No prometre recàrrega sola.
- **Vault OneDrive dataless**: llegir adjunts de Recursos pot donar EDEADLK; passar pels
  camins de materialització existents (daemon 5009) i timeouts.
- **Sense API key** el motor degrada a 503 (com `/api/ai/generate`). Ollama a Intel dona
  pitjor resultat que Groq/Anthropic per a la ingesta.
- **Idioma**: el prompt d'ingesta ha de respectar l'idioma del vault (configurable a
  l'Esquema del Cervell).
- **Doble writer del registry** (`vault_routes` + `vault_views_routes`): qualsevol writer
  nou ha de refrescar les dues caches o els lectors serveixen fins a 30s de dades velles.
