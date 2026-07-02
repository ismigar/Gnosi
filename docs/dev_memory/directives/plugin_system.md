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

**Resolt (2026-07-02, FASE 2):**
- ✅ **Instal·lació des de .zip**: `plugin_system.install_from_zip` (validació de manifest ABANS d'escriure + extracció anti zip-slip/zip-bomb) + endpoints `POST /plugins/install` (upload) i `DELETE /plugins/{id}` (desinstal·la + neteja estat). UI a `PluginsSettings.jsx`: botó "Instal·la des d'un .zip" + paperera per plugin. Instal·lat → arrenca DESACTIVAT i sense permisos.
- ✅ **Galeria/catàleg**: `plugin_catalog.py` (fonts `bundled` des de `plugins-examples/` comprimint al vol, i `url` remot) + `plugins-examples/catalog.json` + endpoints `GET /plugins/catalog/list` i `POST /plugins/catalog/install` ({id}|{url}). Secció "Galeria" a la UI amb instal·lació d'1 clic.
- ✅ **Més punts d'extensió**: nous esdeveniments emesos `page:created` i `page:deleted` (a més de `page:updated`/`clone:finished`); nous mètodes host `vault.listTables` (gated `vault:read`), **`vault.createPage`** (gated `vault:write`, crea .md nou via `save_page_md`+`register_page_in_index`) i **API de settings** `settings.get`/`settings.set` (gated `settings` — tanca el permís que abans estava declarat però inert; endpoints `GET/PUT /plugins/{id}/settings`). Els handlers del host ara reben `(args, plugin_id)` perquè `settings.*` sàpiga a quin plugin pertoquen. Verificat live (listTables 4 taules, createPage al vault real, settings roundtrip).

- ✅ **API read/write UNIFICADA (footgun resolt)**: el `writePage` de dades ja NO fa overwrite del fitxer sencer (es carregava el frontmatter/sidecar); ara llegeix amb `parse_frontmatter`, fusiona `content` i/o `metadata` i reescriu amb `save_page_md` — igual que el PATCH de la UI. `readPage` retorna forma estructurada `{pageId, title, content(cos), metadata}` en ELS DOS runtimes. UI `writePage(id, "text"|{content,metadata})`. Test `test_sandbox_write_page_preserves_frontmatter`.
- ✅ **Verificació d'integritat (SHA-256)** per instal·lacions remotes: `install_from_url(url, sha256)` + entrades de catàleg `url` amb `sha256` (via `install_catalog_entry`) + camp `sha256` a `POST /plugins/catalog/install`. Rebutja si el hash no coincideix (detecció de manipulació/corrupció). Mecanisme de confiança mínim mentre no hi hagi signatura formal. Test `test_install_from_url_checksum_mismatch`.

- ✅ **Versionat de l'API** (`apiVersion`): constant `ps.PLUGIN_API_VERSION = 1`; el manifest declara `apiVersion` (per defecte 1). Si demana una MAJOR superior, `read_manifest` i `install_from_zip` la refusen amb missatge clar ("necessita un Gnosi més nou") → els plugins no es trencaran silenciosament en canvis d'API futurs. Exposada a `GET /plugins/catalog` → `apiVersion`. Incrementar-la NOMÉS en canvis incompatibles.
- ✅ **Exemple ric `vault-stats`** (a `plugins-examples/` + catàleg): comanda que fa `listTables`+`queryDB` de cada taula i desa el recompte a `settings` — exercita bona part de l'API i serveix de plantilla. Verificat live (galeria de 3 entrades, instal·lació OK).

## FASE 3 (feta 2026-07-02) — signatura, confiança i índex remot

- ✅ **Signatura Ed25519** (`plugin_signing.py`, via `cryptography`): signatura DETACHED sobre els bytes del zip. `sign`/`verify`/`generate_keypair` + magatzem de confiança (`.gnosi/plugins_trust.json` + `BUNDLED_TRUSTED_KEYS` buides de sèrie). Política: entrada amb `signature` que verifica amb clau de confiança → instal·la (`signedBy=<nom>`); que NO verifica → REBUTJA; sense signatura → instal·la marcada `signedBy=None` ("no verificat").
- ✅ **Integració a la instal·lació remota**: `install_from_url(url, sha256, signature)` + `install_catalog_entry` verifiquen sha256 I signatura abans d'escriure. `POST /plugins/catalog/install` accepta `signature`.
- ✅ **Endpoints de confiança**: `GET /plugins/trust` (noms + fingerprint), `POST /plugins/trust` (afegeix clau, admin), `DELETE /plugins/trust/{name}` (admin).
- ✅ **Índex remot**: `plugin_catalog.fetch_remote_index(url)` + `load_catalog(registry_url)` fusiona entrades remotes amb les `bundled` (bundled tenen prioritat). URL a `.gnosi/plugins.json` → `registry_url`, via `GET/PUT /plugins/registry-url` (admin).
- ✅ **Eina d'autor**: `plugins-examples/sign_plugin.py` (`keygen` + `sign`) — depèn només de `cryptography`, imprimeix una entrada de catàleg amb `sha256`+`signature`.
- ✅ **UI**: distintiu "signat"/"no verificat" a la galeria + secció "Font remota i confiança" (URL d'índex + gestió de claus) a `PluginsSettings.jsx`.
- Verificat: 51 tests (11 de signatura: roundtrip, tamper, clau incorrecta, magatzem, trusted/untrusted/tampered install, unsigned, índex remot, flux E2E de l'eina). Live: eina keygen+sign OK, endpoints trust/registry-url OK, build+lint nets.

## Deute residual TANCAT (2026-07-02)

- ✅ **Clau oficial**: `BUNDLED_TRUSTED_KEYS["gnosi-official"]` porta ara la clau pública real; la PRIVADA viu a `~/.gnosi-local/plugin_signing_key.json` (600, FORA del repo). Documentat a `plugins-examples/README.md` (rotació + custòdia). Test `test_bundled_official_key_valid_and_loaded` + live: signar amb la privada oficial → verifica com `gnosi-official`.
- ✅ **QA visual del modal FETA** (preview 5199, `vite preview` amb proxy `/api` afegit + `.claude/launch.json`): el panell Configuració → Plugins renderitza correctament tot (built-in, plugins de tercers amb paperera/permisos, Galeria amb les 3 entrades "Instal·lat", "Instal·la des d'un .zip", "Font remota i confiança" amb la clau `gnosi-official` visible).
- 🐛 **Bug i18n preexistent trobat i corregit**: la pestanya de plugins sortia etiquetada "Conectores" (ES) / "Connectors" (CA) — traducció antiga. Corregit a `locales/es|ca/translation.json` → "Plugins" (consistent amb EN i amb el títol del panell).

- ✅ **Pipeline de distribució FET** (2026-07-03): `plugins-examples/build_index.py` construeix i SIGNA l'índex remot de plugins oficials (llegeix la privada de l'entorn `GNOSI_PLUGIN_SIGNING_KEY`, mai del disc; sense clau → índex sense signatura). Connectat al job `release` de `build-release.yml` (checkout + python + build_index → publica `*.zip` + `plugins-index.json` com a assets del release a `ismigar/Gnosi`, base URL `releases/latest/download`). Secret `GNOSI_PLUGIN_SIGNING_KEY` afegit al repo `ismigar/Projectes` (xifrat). URL oficial suggerida al camp de la UI. Verificat live: build_index signa i l'índex verifica com `gnosi-official`.

**Limitació residual (mínima):**
- El bloqueig dur de xarxa cobreix plugins ESM; primitives internes de Node (`process.binding`) fora d'abast (restringides/deprecades). La cadena de distribució queda activa quan es publica (no draft) un release amb tag `v*`.

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
