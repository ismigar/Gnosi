# Bug-hunt findings — auditoria nocturna autònoma

> Iteració automàtica de bug-hunting. Aquesta nota llista bugs detectats i NO
> arreglats automàticament (perquè requereixen revisió manual o decisió de
> producte). Els que sí s'han arreglat tenen el seu propi commit.

## Bugs arreglats automàticament (commitats)

| Commit | Fitxer | Descripció |
|---|---|---|
| `5e32bbf8f` | `frontend/src/hooks/useMailTags.js` | Rules of Hooks violation: `ctx ?? useMailTagsImpl()` cridava un hook condicionalment. Substituït per throw si no hi ha Provider. |
| `0ee84453b` | `backend/api/vault_views_routes.py` | `except Exception` engolia HTTPException explícits ("VAULT_PATH no configurat") → afegit `except HTTPException: raise`. |
| `50782350b` | `backend/api/ai_routes.py`, `integrations_routes.py` | IO síncron dins endpoints `async def` (llm.invoke, requests.*, imaplib, smtplib). Embolcallat amb `asyncio.to_thread()` per no bloquejar l'event loop fins a 10s. |
| `89307110c` | `backend/api/identity_routes.py` | `json.dump` directe → `safe_write_json` per escriptura atòmica. |
| `89307110c` | `backend/api/analytics_routes.py` | Any 2026 hardcoded al `_parse_date` → `datetime.now().year`. |
| `89307110c` | `backend/scheduler/manager.py` | `_save_config` engolia errors silenciosament i no era atòmic → log + `safe_write_json`. |
| `89307110c` | `backend/api/vault_routes.py` (serve_vault_image) | `except Exception` engolia HTTPException(404) per fitxer buit OneDrive → fitxer placeholder es servia com a buit en lloc de 404. |
| `db76e58b7` | `backend/api/env_routes.py` | HTTPException(400) engolida + escriptura no atòmica de .env_shared. |
| `db76e58b7` | `backend/agent/generated_tools/test_sandbox.py` | Thread no daemon: tools penjats impedien shutdown del procés. |
| `f3fc653c5` | `backend/api/mail_routes.py`, `calendar_routes.py`, `contacts_routes.py` | `asyncio.get_event_loop()` deprecat dins async (7 ocurrències) → `asyncio.to_thread()`. |
| `9e52b77cd` | `backend/agent/generated_tools/creator.py` | Creator escrivia tools a `Path(__file__).parent` però loader llegeix de `cfg.paths.AGENT_TOOLS` → tools auto-aprovats no es carregaven mai. |
| `9e52b77cd` | `backend/services/integration_manager.py` | Race condition: 4 mètodes RMW sense lock. integrations.json (totes les credencials!) escrit no atòmicament → corruption en cas de crash. |
| `9e52b77cd` | `backend/services/mail_metadata_manager.py` | Race condition: `update_metadata` RMW sense lock → updates concurrents podien perdre canvis. |
| `0f5e63f35` | `backend/api/config_routes.py` | params.yaml escrit no atòmicament + HTTPException engolida. |
| `0f5e63f35` | `backend/api/vault_graph_routes.py` | `build_unified_graph` (rglob + Fruchterman-Reingold) síncron dins async → bloquejava event loop segons. |
| `047748450` | `backend/api/social_routes.py` | `interact_with_post` retornava 500 enganyós si network/action invàlid → ara 400 amb llistat d'opcions vàlides. |
| `b60941e45` | `backend/data/management_db.py` | Sense lock a `_get_or_init_mgmt_engine` → dos requests concurrents al primer arrencada podien crear engines paral·lels. Afegit double-checked locking. |
| `dfb2331da` | `backend/api/virtual_fields.py` | Mètriques NX (betweenness, pagerank, etc.) tornaven valors caducats després del refresh del graf perquè la invalidació es feia a `_get_nx_graph` cridada DESPRÉS del check al cache. |
| `dfb2331da` | `backend/services/rule_engine.py` | RuleEngine cachejat per vault i compartit entre requests, però `process_updates` resetejava `_current_note_id`/caches sense lock → fórmules concurrents intercanviaven resultats. |
| `dfb2331da` | `backend/services/audio_summarizer.py` | `start_generation_async` check-then-act sense lock → dos clients podien arrencar dues generacions Groq simultànies (~5 min cadascuna, cost real). |
| `dfb2331da` | `frontend/src/components/Vault/VaultTable.jsx` | `handleCellSave`: `if (response.ok)` sense `else` engolia 4xx/5xx. `metadata.hasOwnProperty(k)` substituït per `Object.prototype.hasOwnProperty.call`. |
| `a656d0b23` | `backend/server.py` | global_exception_handler retornava `str(exc)` al client (paths absoluts, SQL fragments, tokens). Ara només `error_id` per cross-ref amb log local. CORS misconfig spec-incompatible (origin=* + credentials=true). |

## Bugs detectats — NO arreglats (decisió/revisió manual)

### 1. `backend/app.py` (Flask) — fitxer fantasma
- El backend real és FastAPI a `backend/server.py` (entrypoint Docker via `uvicorn backend.server:app`).
- `backend/app.py` és Flask, importa `input_routes.py` (Flask Blueprint) i altres `_bp` → mai s'executa en producció.
- A més, `input_routes.py:22` usa `DEFAULT_NOTE_TYPE` sense importar-lo → `NameError` si algú executés `python3 backend/app.py` directament.

**Recomanació:** decidir si es pot eliminar `backend/app.py` i tots els fitxers `*_bp.py` Flask, o si encara s'usen en algun script. Risc baix: per portabilitat futura, esborrar codi mort.

### 2. `backend/agent/generated_tools/loader.py:110-111` — falsa positivització de tools
```python
if callable(attr) and hasattr(attr, 'name'):
    return attr
```
Massa permissiu. Pot capturar callables aleatoris amb `.name` (ex. funcions decorades amb metadades) abans de trobar el `BaseTool` real.

**Recomanació:** restringir a `StructuredTool` o exigir un marker `__tool__ = True` explícit.

### 3. `backend/agent/generated_tools/registry.py` — docstrings després de `_ensure_init()`
Tots els mètodes (`search_existing`, `get_by_name`, `list_pending`, etc.) tenen el patró:
```python
def search_existing(...):
    self._ensure_init()
    """Search for an existing tool..."""  ← això NO és docstring
```
Els docstrings haurien d'anar abans de cap codi. Actualment són expression statements inerts. Conseqüència: `help(registry.search_existing)` no mostra res.

**Recomanació:** moure docstrings a la primera línia del cos de funció.

### 4. `backend/api/system_routes.py:38-49` — error 200 amb body `{"success": False}`
`clear_notifications` retorna 200 OK amb cos `{success: False, error: ...}` quan la BD falla. El frontend no veurà 5xx, així que pensarà que l'operació ha tingut èxit.

**Recomanació:** raise HTTPException(500) en lloc de retornar success: False amb status 200.

### 5. `backend/api/social_routes.py:258-285` — `interact_with_post` 500 per network desconegut
Si `request.network` no és "mastodon" ni "bluesky", o si l'`action` no és coneguda, `success` queda False i el codi llança 500. Hauria de ser 400 Bad Request.

**Recomanació:** validar el `network` i `action` explícitament al principi i raise 400 amb missatge clar.

### 6. `frontend/src/pages/SchedulerPage.jsx:50` — lint warning `react-hooks/set-state-in-effect`
És el patró estàndard de "fetch on mount". El lint és massa estricte aquí, però val la pena suprimir el warning explícitament per no contaminar les estadístiques de lint.

**Recomanació:** afegir `// eslint-disable-next-line react-hooks/set-state-in-effect` o reescriure amb el patró `useSWR`/`useQuery` quan s'integri.

### 7. ESLint — 267 errors al frontend (266 reals + 1 tema schedulers)
La majoria són `no-unused-vars` (variables capturades però no usades) i alguns `no-empty` (catch buits). Els més perillosos:
- `pages/VaultDashboard.jsx`: 19 errors, molts `err` capturats sense logging — silenciaria errors reals.
- `pages/Dashboard.jsx`: 6 `e` capturats sense usar.
- `pages/MediaCenter.jsx`: 6 vars no usades, possible codi mort.

**Recomanació:** passada de neteja en una iteració dedicada (run `npx eslint src --fix`, després revisió manual dels que no es poden auto-fix).

### 8. `backend/api/mail_routes.py:235` — `asyncio.get_event_loop()` deprecat
Dins funció async; hauria de ser `asyncio.get_running_loop()` o, millor, `asyncio.to_thread(...)` directament. A Python 3.12+ això pot fallar.

### 9. Bare `except: pass` patterns nombrosos
- `backend/services/media_service.py:110, 120` — silencia errors d'EXIF parsing (acceptable defensiu, però val la pena log.debug)
- `backend/services/imap_mail_sync_service.py:911` — silencia errors al netejar fitxers locals
- `backend/services/graph_service.py:846, 862` — desconegut
- `backend/api/mail_routes.py:219, 467, 588, 882, 899` — silencien errors a operacions IMAP

**Recomanació:** sweep dedicat per substituir per `except Exception as e: log.debug(...)`. No urgent però oculta bugs reals.

### 10. `backend/api/integrations_routes.py:127` (post-fix) — segon `requests.get` sense to_thread
Va quedar arreglat al fix #50782350b, però val la pena verificar al codi actual.

### 11. `frontend/src/hooks/useVaultViewData.js:17` — variable `schema` no usada
Trivial, però possible deute de l'última refactor de vistes.

### 12. `backend/server.py:138-144` — CORS misconfiguration
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,  # ⚠️ Incompatible amb origins=["*"]
    ...
)
```
La spec CORS prohibeix `Access-Control-Allow-Credentials: true` quan `Allow-Origin: *`. Els navegadors rebutgen requests amb credentials. En personal mode local potser no es noten errors, però si s'activen requests autenticats cross-origin, fallaran silenciosament.

**Recomanació:** llistar origins explícits (`["http://localhost:3000", "http://localhost:5173"]`) o desactivar `allow_credentials` si no s'usa.

### 13. `backend/server.py:155-179` — global_exception_handler filtra detalls
El handler retorna `error_detail = str(exc)` al cos de la resposta 500. Si l'excepció conté paths absoluts, tokens, traces de DB, el frontend (i potencialment proxies/logs intermedis) ho rebran en clar.

**Recomanació:** loggar el detall però retornar només `{"detail": "Internal server error"}` al client, sense `"error"`.

### 14. `backend/services/imap_mail_sync_service.py:215` — `socket.setdefaulttimeout(30)` global
Setejar el timeout per defecte global afecta TOTS els sockets del procés (graph fetch, calendar APIs, requests fora del IMAP). És un side-effect que escapa el `_connect`.

**Recomanació:** usar `imap.sock.settimeout(30)` per-connexió en lloc del global.

### 15. `backend/services/feed_ingester.py:71` — `if True: # pub_date > target_time:`
Codi mort — l'if sempre és True. El comentari diu que es va treure el filtre 24h. Hauria de ser `if pub_date > target_time:` o eliminar la condició entera.

### 16. `backend/api/workspace_routes.py:247-250` — `WorkspaceResponse.from_orm(None)`
Si la membership existeix però el workspace s'ha eliminat (cas corrupte), `from_orm(None)` crashejaria. Cas marginal però val la pena un None check.

### 17. `backend/agent/generated_tools/dry_run.py:52` — `hash() % 10000` collision risk
```python
execution_id = f"{tool_name}_{hash(json.dumps(arguments, default=str)) % 10000}"
```
Dos tool calls diferents poden col·lidir amb només 100 pendents (paradoxa de l'aniversari, ~40%) i sobreescriuen-se al `_pending_executions`. Substituir per `uuid.uuid4().hex[:8]`.

### 18. `backend/api/env_routes.py` i `config_routes.py` — sense auth
Cap dels dos routers té `Depends(require_role(...))` ni a router-level ni a endpoint-level. En personal mode (mono-usuari local) no afecta, però si s'activa "organitzacio" mode, qualsevol usuari pot llegir/escriure env vars i config (path del vault, providers AI, etc.).

**Recomanació:** afegir `dependencies=[Depends(require_role("admin"))]` als routers o validar `gnosi_mode == "organitzacio"` per requerir auth.

### 19. `backend/agent/generated_tools/test_sandbox.py:149-150` i `loader.py:110-111` — falsa positivització
Mateix patró `callable(attr) and hasattr(attr, 'name')`. Pot retornar callables aleatoris amb `.name` abans de trobar el `BaseTool`. Recomanació: marcar els tools amb un atribut explícit `__tool__ = True`.

## Patrons recurrents a vigilar

### A. `except Exception` engolint HTTPException explícits
Patró perillós: dins un `try:` que llança HTTPException explícit, el `except Exception` posterior atrapa l'excepció i la transforma en una de genèrica, perdent el missatge i el status code original.

**Sweep recomanat:** afegir `except HTTPException: raise` abans del `except Exception` a totes les rutes `async def` que llancen HTTPException dins el try.

### B. Escriptures JSON no atòmiques
A diversos llocs encara es fa `json.dump(data, open(path, "w"))` o equivalent. Si el procés cau a meitat, el fitxer es queda truncat. `safe_write_json` ja existeix i s'hauria d'usar sempre.

**Sweep recomanat:** grep per `json.dump(.*open(` i substituir per `safe_write_json`.

### C. IO bloquejant a endpoints `async def`
FastAPI executa endpoints async al mateix event loop. Qualsevol `requests.*`, `time.sleep`, `imaplib.*`, etc. dins async bloqueja TOTS els altres requests fins que retorni.

**Sweep recomanat:** revisar cada `async def` per crides bloquejants i envoltar amb `asyncio.to_thread()`.

---

Última actualització: auditoria autònoma 2026-05-01 ~01:00. Pròxima iteració al despertar de l'agent.
