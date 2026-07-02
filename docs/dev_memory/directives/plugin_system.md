# Sistema de plugins de Gnosi — de v1 (features internes) a v2 (tercers estil Obsidian)

> Disseny obert 2026-07-02 (petició Ismael): «té sentit un sistema de plugins estil Obsidian on la
> gent implementi els seus, o fins i tot serveixin els d'Obsidian?». Resposta: **plugins PROPIS sí
> (UI + dades); compatibilitat literal amb Obsidian NO**. Aquesta directiva és el PLA de referència;
> encara NO hi ha codi de v2. Revisar/retocar abans de construir (Central Loop: pla → codi).

## ✅ ESTAT D'IMPLEMENTACIÓ (2026-07-02) — v2 CONSTRUÏT i verificat E2E

Les 4 fases estan implementades i provades (22 tests verds + E2E live backend i UI).

**Backend:**
- `backend/services/plugin_system.py` — descobriment, validació de manifest, model de permisos (pur).
- `backend/services/plugin_events.py` — bus d'esdeveniments fire-and-forget (`emit`).
- `backend/services/plugin_sandbox.py` + `plugin_runtime/runner.mjs` — sandbox de dades: `node --permission` + pont JSON-RPC verificat per permisos.
- `backend/services/plugin_dispatcher.py` — uneix bus↔sandbox + handlers del host (`vault.readPage/writePage`, `network.fetch`); `wire()` a `server.py` lifespan.
- Endpoints a `vault_routes.py`: `GET /plugins/catalog`, `GET /plugins/installed`, `POST /plugins/{id}/permissions`, `GET /plugins/{id}/asset/{path}` (path-safe). Estat a `.gnosi/plugins.json` (clau `granted`).
- Emissió real: `clone:finished` a `notion_routes._clone_progress_cb`; `page:updated` quan un plugin escriu.

**Frontend:**
- `frontend/src/plugins/host.js` — amfitrió: iframe `sandbox="allow-scripts"` (origen opac) + CSP, pont `postMessage`, store de contribucions.
- `frontend/src/plugins/usePluginHost.js` — hook React + `reloadPlugins`.
- `CommandPalette.jsx` — fusiona comandes de plugins sota la secció "Plugins".
- `PluginsSettings.jsx` — secció "Plugins de tercers": llista, activar/desactivar, concedir permisos.

**Exemples:** `monorepo/apps/gnosi/plugins-examples/` (`hello-command` UI, `clone-logger` dades). S'instal·len copiant-los a `<vault>/.gnosi/plugins/`.

**Verificat:** endpoints (installed/catalog/grant/asset + traversal→400); data-plugin live (emit→dispatcher→Node→plugin rep payload); UI-plugin live (iframe muntat→registerCommand→paleta→run→pont host→backend); denegació de permís (pytest). `npm run build` OK.

**Resolt (2026-07-02, segona iteració):**
- ✅ `vault.queryDB` IMPLEMENTAT (backend `_handle_query_db` via `_get_pages_for_table` + frontend via `/pages/by-table/{id}`), amb `limit` (200/màx 1000) i flag `truncated`. Verificat live (taula de 273 files). Gated per `vault:read`.
- ✅ Bloqueig de `network` als plugins de DADES ara és DUR: `runner.mjs` fa `module.registerHooks` (hook ESM síncron, compatible amb `--permission` sense worker) que rebutja tot `import` de `node:net/http/https/tls/dgram/http2/module` + neutralitza globals (fetch/WebSocket/XMLHttpRequest/EventSource). Amb child_process/worker/addons ja bloquejats per `--permission`, un plugin ESM no pot obrir xarxa. Test: `test_sandbox_network_hard_block`.

**Limitacions honestes (deute conegut, fase 4+):**
- Asimetria d'API llegir/escriure entre UI (PATCH parcial via `/pages/{id}`) i dades (fitxer sencer via `safe_write_text`). Unificar a fase 4.
- Sense canal de distribució ni signatura de plugins (community plugins) — veure `gnosi_distribution_plan.md`.
- Instal·lació encara manual (copiar carpeta); falta UI d'instal·lació des de zip/URL.
- El bloqueig dur de xarxa cobreix plugins ESM (l'únic format suportat); no s'ha auditat cada primitiva interna de Node (`process.binding` i similars queden fora de l'abast, però estan restringits/deprecats).

## Punt de partida REAL (no és greenfield) — v1 ja existeix

Auditoria de codi 2026-07-02: Gnosi ja té un «sistema de plugins» v1, però és un **registre de
features INTERNES**, no un runtime de tercers:

- **Frontend**: `frontend/src/plugins/registry.js` (`BUILTIN_PLUGINS`: `daily-notes`, `tags-page`,
  `page-comments`, `share-links`, `canvas-cards`) + `frontend/src/plugins/usePlugins.js` (store amb
  subscripció: `isEnabled`, `setPluginEnabled`, `get/setPluginSettings`).
- **Config UI**: `frontend/src/components/PluginsSettings.jsx` (panell a Configuració; p. ex. config
  de `daily-notes` per triar BD font de la nota del dia).
- **Backend/persistència**: `GET/PUT /api/vault/plugins` a `backend/api/vault_routes.py` (~L4340+);
  estat vault-first a `.gnosi/plugins.json` (`{disabled:[...], settings:{...}}`).
- **Frontera declarada al codi**: comentari a `registry.js` i `vault_routes.py` L4342-4343 —
  *«Third-party/sandboxed plugins are an explicit non-goal of v1 (security)»*. O sigui: v1 només
  encén/apaga codi que JA és a l'app; no carrega res extern.

**Conclusió**: v2 no comença de zero. Reutilitza el manifest lògic (`id`, `name`, `description`,
`icon`, `settings`), el store `usePlugins`, el panell de config i l'endpoint de persistència. El que
falta és: **manifest de fitxer, càrrega dinàmica, permisos, sandbox i punts d'extensió executables**.

## Objectiu v2 i NO-objectius

**Objectiu**: que un tercer (o el mateix Ismael) pugui empaquetar un plugin que Gnosi carrega i
executa, tant de **UI** (vistes, comandes, panells) com de **dades** (hooks sobre el vault i
integracions), amb un model de permisos que l'usuari aprova.

**NO-objectius (decidits en aquesta sessió):**
- ❌ **Executar plugins d'Obsidian tal qual.** Es compilen contra l'API d'Obsidian (`import {...}
  from "obsidian"`), CodeMirror 6 i el seu model markdown+`MetadataCache`. Gnosi usa `BlockEditor`
  propi + Tldraw + BDs amb `resolved_table_id`/`.gnosi/page_meta` → l'abstracció `Vault`/`Editor`
  d'Obsidian no mapeja. Reimplementar-ho és un pou sense fons contra un objectiu mòbil.
- ➜ **Alternativa a futur**: capa de compatibilitat PARCIAL i EXPLÍCITA (un shim que implementa el
  subconjunt d'API que usen 4-5 plugins concrets que interessin), venuda com «suportem *aquests*
  plugins», mai «suportem Obsidian». Fora de l'MVP.

## Arquitectura v2 (nucli comú + dues branques)

Una sola arquitectura amb dos punts d'enganxada, units per **manifest** + **model de permisos** +
**bus d'esdeveniments** compartits.

### Nucli comú
- **Manifest** `manifest.json` per plugin: `id`, `version`, `name`, `description`, `icon`, `main`
  (entry frontend, opcional), `backend` (entry dades, opcional), i **`permissions[]` declarats**
  (`vault:read`, `vault:write`, `vault:delete`, `network`, `ui:view`, `ui:command`, `ui:sidebar`,
  `settings`). L'usuari els veu i els aprova en instal·lar (estil Android/Obsidian «community
  plugin»). Extensió natural del registre declaratiu de v1.
- **Registre + carregador**: carpeta `.gnosi/plugins/<id>/` (vault-first, com `plugins.json`).
  Activar/desactivar reusa `_disabled` de `usePlugins`. Versionat al manifest.
- **Bus d'esdeveniments**: esdeveniments del vault als quals s'enganxen ambdues branques —
  `vault:page-created|updated|deleted`, `import:finished`, `clone:finished`, `db:row-changed`.
  Reutilitzar/estendre el que ja hi ha: `services/action_rules.py` (accions de botó) i el
  `rule_engine`/automations (`property_change`). Vigilar la frontera ja documentada a
  `action_rules.py`: automations = canvis de dades; action_rules = accions de botó. El bus de
  plugins és un TERCER consumidor, no ha de trencar aquesta separació.

### Branca UI (frontend)
- El plugin corre dins d'un **iframe/Worker sandbox** i parla amb Gnosi per `postMessage` (mai
  `require`/accés directe al DOM de Gnosi → així el sandbox es manté i no pot fer RCE al render).
- API de punts d'extensió (mínima, estable): `registerCommand()`, `registerView()`,
  `addSidebarPanel()`, `registerSetting()`. Cadascun només disponible si el permís corresponent
  (`ui:*`) és al manifest i aprovat.
- El panell de gestió estén `PluginsSettings.jsx` (llista, activar/desactivar, veure permisos,
  desinstal·lar).

### Branca dades (backend)
- Corre al FastAPI com a **hook** sobre el bus, dins d'un **sandbox d'execució**: QuickJS/Deno per
  plugins JS, o subprocés capat per Python. MAI `exec()` al procés del backend.
- API: `onEvent()`, `readPage()`, `writePage()`, `queryDB()` — **tot filtrat pels permisos del
  manifest** i (en mode org) per `VaultAccess`/grants de l'usuari (veure `auth_multiuser_design.md`).

## ⚠️ La peça crítica: model de permisos + sandbox (clavar-la ABANS d'ampliar API)

Gnosi és **Electron sobre un vault OneDrive real**. Un plugin amb `require('fs')` = **RCE total sobre
el disc de l'usuari**. Obsidian ho assumeix (confiança total, «plugins no verificats»); Gnosi vol
self-host/multi-usuari (`auth_multiuser_design.md`), així que NO pot copiar aquell model relaxat.

- **Regla d'or**: un plugin només pot fer el que ha **declarat al manifest** i l'usuari ha **aprovat**.
  Sense permís → l'API ni tan sols existeix per a aquell plugin.
- **UI**: iframe/Worker aïllat, comunicació només per `postMessage`, CSP estricta (com els Artifacts:
  res de hosts externs si no hi ha permís `network`).
- **Dades**: sandbox de procés (QuickJS/Deno/subprocés), sense `fs`/`net`/`env` per defecte; l'accés
  al vault passa SEMPRE per l'API filtrada, mai per rutes de fitxer directes.
- **Interacció amb OneDrive**: un plugin de dades que escriu al vault ha de passar pels mateixos
  camins que materialitzen fitxers online-only (daemon 5009) per no reintroduir EDEADLK — no llegir
  fitxers del vault pel seu compte (veure memòries d'EDEADLK/warmup daemon).

## Pla per FASES (dissenyar sencer, implementar per trossos)

1. **Nucli**: manifest de fitxer + carregador des de `.gnosi/plugins/<id>/` + panell de gestió (estén
   `PluginsSettings.jsx`) + model de permisos declarat. Encara sense executar tercers → només valida
   el format i el flux d'aprovació.
2. **Fase UI**: UN sol punt d'extensió (`registerCommand`) amb sandbox iframe. Valida el model de
   seguretat al frontend amb un plugin de joguina.
3. **Fase dades**: UN sol hook (`onEvent('import:finished')`) amb sandbox backend. Valida el model al
   backend amb un plugin de joguina.
4. **Ampliar superfície d'API** segons casos reals (millor 15 punts ben pensats que intentar-ho tot
   el dia 1). Aquí es decideix si val la pena el shim de compatibilitat parcial amb Obsidian.

## Restriccions / Edge Cases

- **No prometre compatibilitat amb Obsidian.** Si es fa el shim, enumerar els plugins suportats un a
  un; mai «funciona amb plugins d'Obsidian».
- **Backend natiu SENSE --reload** (memòria `backend_no_autoreload`): un carregador de plugins de
  dades que registri rutes/hooks nous necessita `kickstart -k com.gnosi.backend` o un mecanisme de
  recàrrega propi; no s'aplicarà sol.
- **Vault-first + dos Macs** (`two_computer_workflow`): `.gnosi/plugins/` viatja per OneDrive → un
  plugin instal·lat en un Mac apareix a l'altre; pot arribar dataless (EDEADLK). Decidir si els
  binaris de plugin es materialitzen com la resta del vault o van a `local_data`.
- **Mode org/multi-usuari**: qui pot instal·lar plugins? Un plugin de dades corre amb els permisos de
  QUIN usuari? Ha de respectar `VaultAccess`/grants. Bloquejant per a self-host; irrellevant per a
  desktop individual.
- **Distribució** (`gnosi_distribution_plan`): si hi ha «community plugins», cal un canal (repo/índex)
  i signatura/confiança. Fora de l'MVP però condiciona el manifest (afegir camps d'autor/font).

## Fitxers relacionats (v1, a reutilitzar/estendre)
- `frontend/src/plugins/registry.js`, `frontend/src/plugins/usePlugins.js`
- `frontend/src/components/PluginsSettings.jsx`
- `backend/api/vault_routes.py` (`GET/PUT /api/vault/plugins`, `_load_plugins_state`, ~L4340+)
- `.gnosi/plugins.json` (estat) → futur `.gnosi/plugins/<id>/` (plugins instal·lats)
- `backend/services/action_rules.py` + rule_engine/automations (bus d'esdeveniments existent)

## Directives/memòries relacionades
- `auth_multiuser_design.md` (permisos, VaultAccess/grants — el sandbox de dades hi depèn)
- `environment_integrity.md` (natiu, EDEADLK, daemon 5009)
- `gnosi_distribution_plan.md` (canal de distribució de plugins a futur)
