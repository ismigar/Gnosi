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
