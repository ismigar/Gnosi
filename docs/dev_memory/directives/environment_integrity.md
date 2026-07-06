# Environment Integrity Directive (Docker vs Local)

> ⚠️ **ACTUALITZACIÓ 2026-06-17: Gnosi corre NATIU per defecte** (backend `uvicorn` :5002 + frontend `vite` :5173 via LaunchAgents). **Docker és ara OPCIONAL** (self-host en servidor). Les regles de "Docker priority" i tot el runbook de rebuild/volums de Docker d'aquest document apliquen **NOMÉS si fas servir Docker**; en el flux natiu per defecte, no. Runbook natiu a la secció "PROJECTE: migrar Gnosi a NATIU" més avall.

## Objective
Prevent development environment fragmentation where multiple instances of the same service run simultaneously (e.g., Docker frontend on 5173 and Local frontend on 5174).

## Constraints
1. **Port Lockdown**: The frontend MUST ALWAYS run on port `5173`. 
2. **Anti-Ghosting**: If port `5173` is occupied by a Docker container, you MUST NOT start a local `npm run dev` that jumps to `5174`.
3. **Priority** *(només si uses Docker)*: no barregis Docker i natiu al mateix port. En el flux natiu per defecte (recomanat), el servei nadiu és l'únic a `5173`/`5002`.

## Technical Mechanisms
- **Vite Strict Port**: `vite.config.js` must have `server.strictPort: true`.
- **Pre-flight Check**: Before running local services, check for active containers:
  ```bash
  docker ps | grep gnosi_frontend
  ```

## Resolution Protocol
If you detect a conflict:
1. **DO NOT** use the service on port `5174`.
2. **STOP** the local process.
3. **VERIFY** the Docker container status.
4. **CONNECT** to the existing service on `5173`.

---
*Note: Any screenshot or browser test performed on port 5174 will be considered a QA failure.*

---

## Regla Crítica: Canvis de Codi al Backend Requereixen Reconstrucció d'Imatge

### Problema
`docker-compose restart backend` **NO aplica canvis de codi Python**. Només reinicia el procés dins el contenidor existent, que conté la imatge antiga. Qualsevol modificació de fitxers `.py` al backend serà ignorada fins que es reconstrueixi la imatge.

### Causa
El `Dockerfile` del backend usa `COPY` per copiar el codi a la imatge en el moment del `build`. A diferència del frontend (que munta el codi com a volum amb `.:/app` i beneficia del hot-reload de Vite), el backend no té cap volum de codi en producció/Docker.

### Regla
Després de qualsevol canvi a fitxers Python del backend, cal executar:
```bash
docker-compose build backend && docker-compose up -d backend
```

**Mai** `docker-compose restart backend` per aplicar canvis de codi.

> **Actualització 2026-06-01:** en aquesta màquina el `docker-compose.yml` ja
> munta `backend/` com a **bind mount rw** (`→ /app/backend`) i uvicorn corre amb
> `--reload --reload-dir /app/backend`. Per tant els canvis de codi Python
> **s'apliquen sols (hot-reload) o amb `restart`**, sense `build`. Verifica-ho
> sempre abans d'assumir: `docker inspect gnosi_backend --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'`.
> El `build` continua sent necessari per a canvis de `requirements.txt` o si el
> bind mount del codi desapareix del compose.

### Verificació
Per confirmar que el contenidor executa el codi nou:
```bash
docker exec gnosi_backend grep -n "return None" /app/services/imap_mail_sync_service.py
```
Si no retorna res, el contenidor té el codi antic i cal reconstruir.

### Restriccions / Edge Cases
- `docker-compose up -d backend` sense `build` previ **reutilitza la imatge cacheada** — els canvis segueixen sense aplicar-se.
- Si el canvi afecta dependències Python (`requirements.txt`), cal afegir `--no-cache`: `docker-compose build --no-cache backend`.
- El frontend SÍ usa hot-reload via volum, per tant `restart` o `up -d` sense `build` és suficient per al frontend **per canvis de codi**, però **no per a dependències noves** (vegeu la regla següent).
- **Guions de `pipeline/sandbox/` executats al HOST**: el `python3` del sistema
  (els dos Macs) NO té `requests` ni cap paquet de tercers → escriure'ls NOMÉS
  amb stdlib (`urllib.request` per a HTTP) o executar-los dins del contenidor
  (`docker exec gnosi_backend python ...`). Vist 2026-06-10 amb
  `repair_adjunts_portables.py` (ModuleNotFoundError: requests).

---

## Regla Crítica: Noves Dependències npm al Frontend

### Problema
Afegir un paquet a `frontend/package.json` **no el fa disponible al contenidor frontend**. Vite mostrarà un error com:
```
[plugin:vite:import-analysis] Failed to resolve import "<paquet>" from "src/.../X.jsx".
Does the file exist?
```

Símptoma típic: el `package.json` declara la dependència, però `node_modules/<paquet>` no existeix dins del contenidor.

### Causa
A `docker-compose.yml`, el servei `frontend` usa **dos volums**:
```yaml
volumes:
  - .:/app                          # codi font (hot-reload)
  - /app/frontend/node_modules      # volum anonymous que aïlla node_modules
```
El segon volum (`/app/frontend/node_modules`) és **anonymous**: es crea la primera vegada que s'arrenca el contenidor amb el `npm install` del Dockerfile, i des d'aleshores **persisteix**. Si edites `package.json` des de fora, el `node_modules` del contenidor queda desfasat fins que es reconstrueix explícitament.

Aquesta arquitectura és intencional: evita conflictes entre el `node_modules` macOS/local i el `node_modules` Linux/contenidor (binaris natius incompatibles).

### Regla
Després d'afegir o actualitzar dependències a `frontend/package.json`, cal executar **una de** les opcions següents (per ordre de preferència):

**Opció A — Instal·lació in-place (ràpida, ~10s)**:
```bash
docker exec gnosi_frontend sh -c "cd /app/frontend && npm install"
```
Recomanada per al cas habitual: només afegeixes 1-2 paquets. No cal reiniciar Vite — detecta el canvi automàticament.

**Opció B — Reconstrucció de la imatge (lenta, ~2min)**:
```bash
docker-compose build frontend && docker-compose up -d frontend
```
Necessària si el `Dockerfile.frontend` ha canviat o si vols un `node_modules` totalment net (per exemple després de canvis dràstics al `package-lock.json`).

### Verificació
Confirma que el paquet és accessible des del contenidor:
```bash
docker exec gnosi_frontend ls /app/frontend/node_modules/<paquet>
```
Si retorna error "No such file", la regla A o B encara no s'ha aplicat.

### Restriccions / Edge Cases
- **Mai** facis `npm install <paquet>` al host (macOS) sense fer-ho també al contenidor: el `package-lock.json` quedarà actualitzat però el contenidor no veurà el paquet.
- Si Vite continua donant error després de l'opció A, **fes un hard reload del navegador** (Cmd+Shift+R) — Vite cacheja l'arbre d'imports en memòria del client.
- Aquesta regla **no aplica al backend** (Python): allà cal `docker-compose build` (vegeu la secció anterior).
- Si veus aquest error en un `git pull` net (sense haver tocat `package.json`), pot ser que un company hagi afegit dependencies — aplica l'opció A i tornarà a funcionar.

### Causa-Efecte (memoritzar)
> Afegir paquet a `package.json` → `node_modules` del contenidor desfasat → Vite no pot resoldre l'import → cal `docker exec ... npm install` o `docker-compose build frontend`.

---

## Regla Crítica: Rebuild Sol No Refresca el Volum Anònim de `node_modules`

### Problema
Després d'actualitzar diverses dependencies (peer-deps de Mantine/Tiptap/Blocknote, p. ex. PRs #135-#139), `docker-compose build --no-cache frontend && docker-compose up -d frontend` **no n'hi ha prou**. El contenidor torna a arrencar amb el `node_modules` antic i Vite peta amb errors de mòduls interns que **no són de l'usuari**, com per exemple:

```
Cannot find module '/app/frontend/node_modules/vite/dist/node/chunks/dist.js'
imported from /app/frontend/node_modules/vite/dist/node/chunks/config.js
```

Símptoma típic: el missatge fa referència a fitxers interns de Vite (o d'una altra dep) que el contenidor "no troba" perquè el `node_modules` carregat al runtime és d'una versió de Vite anterior a la que el `package-lock.json` declara ara.

### Causa
El volum `- /app/frontend/node_modules` del `docker-compose.yml` és **anonymous**, no anonymous-per-build. Persisteix lligat al *contenidor*, no a la *imatge*. Mentre el contenidor existeixi (encara que el reaixequis amb `up -d`), Docker hi torna a muntar el mateix volum amb el `node_modules` original (el del primer arrencament). Un `build --no-cache` només refresca la imatge — el volum continua amagant el `node_modules` nou darrere del vell.

### Regla
Per refrescar dependències a fons cal **destruir el contenidor** (i amb ell el seu volum anònim) abans de rebuild:

```bash
docker compose rm -fsv frontend
docker compose build --no-cache frontend
docker compose up -d --no-deps frontend
```

- `-f` força sense confirmar, `-s` atura primer, `-v` elimina **només volums anònims del servei**.
- `--no-deps` evita validar `env_file:` de serveis germans que potser ja corren amb el seu env carregat.

### Verificació
1. Vite arrenca net: `docker logs gnosi_frontend | grep -E "VITE|ready"` → veus línia `VITE v<x.y.z> ready in <N>ms`.
2. HTTP respon: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/` → `200`.
3. Cap "Cannot find module" als logs.

### Restriccions / Edge Cases
- `-v` a `docker compose rm` **no toca volums nomenats** (com `gnosi_local_data` del backend). Només elimina els anònims del servei concret. És segur.
- **No facis `docker compose down -v`** — això sí esborraria `gnosi_local_data` (el SQLite del backend) i perdries tot l'estat local.
- Si Docker Desktop no està al PATH, exporta'l abans: `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"`. Sense això, fer `docker-credential-desktop` falla i no pots ni fer pull de la imatge base.
- Per dependencies menors (1-2 paquets) **no cal** aquest procediment — segueix sent vàlida l'**Opció A** de la secció anterior (`docker exec ... npm install`).
- Aquesta regla aplica només quan el símptoma són **errors interns d'una dep** (Vite, Vitest, etc.), no de codi propi. Si l'error és `Failed to resolve "<el-teu-paquet>"`, l'Opció A és suficient.

### Causa-Efecte (memoritzar)
> `node_modules` és un volum anònim → persisteix entre rebuilds del servei → `build --no-cache` només refresca la imatge, no el volum → cal `compose rm -fsv` ABANS del rebuild quan canvien deps a fons.

---

## Regla Crítica: Vault al Núvol (OneDrive Files-On-Demand) i Fitxers `dataless`

### Problema
El vault es munta des de OneDrive (`${HOME}/Library/CloudStorage/OneDrive-UNED/Gnosi:/vault`). macOS marca els fitxers no descarregats com a **online-only** (flag `dataless`, visible amb `ls -lO` → `compressed,dataless`). Quan el backend, **dins el contenidor**, intenta llegir un fitxer `dataless` a través de la capa virtiofs de Docker, la hidratació sota demanda es bloqueja:

```
OSError: [Errno 35] Resource deadlock avoided   (EDEADLK)
```

Símptomes observats:
- Crash-loop del backend en arrencar si `/vault/.gnosi/params.yaml` és `dataless`.
- `search-citations` torna `[]` (índex de cites buit) i `format-citation` torna `(@key)` (no resol), perquè reobrir els `.md` de Recursos falla i les pàgines se salten en silenci (`except OSError: continue`).

### Causa
Llegir des de l'**amfitrió** funciona (el File Provider natiu hidrata el fitxer), però llegir des de **dins del contenidor** via virtiofs provoca el deadlock. A més, el flag «Mantén sempre en aquest dispositiu» és **per dispositiu**: fer el *pin* al Mac A no descarrega res al Mac B (workflow de dues màquines).

### Regla
1. **El codi de backend que serveix dades del vault NO ha de dependre de reobrir fitxers del vault.** Si la informació ja és a una caché local (p. ex. `_page_index_entries`, persistit al volum nomenat `gnosi_local_data`), construeix la resposta des d'allà i deixa la lectura del `.md` com a *fallback* protegit amb `try/except OSError`.
2. Cap funció d'indexació o format ha de petar ni quedar buida perquè un fitxer sigui `dataless`.

Aplicat a cites (`backend/api/vault_routes.py`):
- `_ensure_cite_key_index` i `_build_csl_items_for_keys` llegeixen `Citation Key`, autors, any i `table_id` de `entry["metadata"]` (page_index cachejat), no del `.md`; el fitxer només es llegeix com a fallback.

### Verificació
```bash
# Un fitxer concret és online-only?
ls -lO "<fitxer>" | grep dataless          # si surt 'dataless' → no descarregat

# El backend resol cites SENSE baixar el vault?
curl -sk "https://localhost:5173/api/vault/search-citations?q=&limit=5"   # ha de tornar resultats
# als logs del backend: "Built cite_key_index: N keys" amb N > 0
```

### Restriccions / Edge Cases
- **`find ... -flags dataless` NO és fiable** a carpetes CloudStorage (l'enumeració de directoris online-only torna falsos negatius / 0 resultats). Comprova-ho fitxer a fitxer amb `ls -lO <fitxer>`.
- Materialitzar un fitxer per CLI: `dd if="<fitxer>" of=/dev/null bs=65536` (força una lectura real de bytes → neteja `dataless`). `wc -c` **no** serveix (només fa `stat`). El `dd` pot ser lent o penjar-se si el File Provider d'OneDrive està saturat.
- Les pàgines de la taula **Recursos** viuen a `BD/Cervell Digital/Recursos/` (no a una carpeta `Recursos` a l'arrel) — per això `find $VAULT/Recursos` no troba res.
- La solució durable per a l'usuari és el *pin* d'OneDrive, però és **per dispositiu** i no sincronitza entre Macs; per això la resiliència ha d'estar al codi, no en l'estat del disc.

### Causa-Efecte (memoritzar)
> Vault a OneDrive → fitxers `dataless` (online-only) → llegir-los dins el contenidor (virtiofs) → EDEADLK → indexació/format de cites buits → construeix SEMPRE des de la caché del `page_index`, i el fitxer només com a *fallback* protegit.

### Fix d'amfitrió: VirtioFS → gRPC FUSE (2026-05-30)

Complementari a la resiliència de codi anterior: el mateix `EDEADLK` també afecta `params.yaml` a l'arrencada (no és `dataless`, és YAML de text normal de 2757 bytes que es llegeix bé des del host). La causa és la **implementació de file sharing de Docker Desktop**: amb **VirtioFS** (el valor per defecte) la lectura de fitxers del File Provider de OneDrive des del contenidor deadlocka de manera intermitent; amb **gRPC FUSE** no.

**Símptoma:** «no carrega cap pàgina ni BD». El frontend (https://localhost:5173) renderitza, però el backend (`gnosi_backend`, :5002) està en crash-loop (`RestartCount` puja, mai `healthy`) petant a `app_config.py:load_params` amb `OSError: [Errno 35] Resource deadlock avoided` en llegir `/vault/.gnosi/params.yaml`.

**Diagnòstic ràpid:**
```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"   # docker NO és al PATH per defecte
docker inspect gnosi_backend --format '{{.RestartCount}} {{.State.Health.Status}}'
docker logs gnosi_backend --tail 50 | grep -i 'deadlock'
```

**Fix permanent (amfitrió):**
1. Atura Docker del tot: `docker desktop stop` + `osascript -e 'quit app "Docker Desktop"'` (el GUI ha d'estar mort o reescriu els settings en sortir). Verifica 0 processos `Docker Desktop`/`com.docker.backend`/`com.docker.virtualization`.
2. Afegeix `"fileSharingImplementation": "gRPC FUSE"` a `~/Library/Group Containers/group.com.docker/settings-store.json` (backup previ a `/tmp/`). Valors acceptats verificats a `app.asar`: `virtiofs`, `osxfs`, `gRPC FUSE`.
3. `open -a Docker`; els contenidors tenen `restart: unless-stopped` → arrenquen sols. Read-back de la clau per confirmar que Docker la manté.

**Verificació QA (feta):** `RestartCount` deixa de pujar i `Health=healthy`; `Application startup complete` als logs (sense `deadlock` nous, validat amb timestamp real `docker logs -t`); `/api/health`→200 JSON; `/api/vault/pages`→200 amb ~2 MB (prova que llegeix el vault de OneDrive des del contenidor sense deadlock); `/api/config` retorna el YAML d'usuari fusionat.

**Restriccions / Edge cases:**
- El recompte `docker logs --since 2m | grep deadlock` enganya: les línies d'uvicorn **no porten timestamp**, així que `--since` no filtra el tràfic vell del crash-loop. Per comptar deadlocks recents cal `docker logs -t --since 30s` (timestamp real de Docker).
- Trampa de verificació: el backend serveix la SPA com a catch-all → rutes `/api/*` inexistents retornen JSON `{"detail":"Not Found"}` (404 correcte del router), no pas la SPA. Per provar que l'API viu, usa rutes reals (`/api/health`, `/api/config`, `/api/vault/pages`), no noms inventats com `/api/dashboards`.
- L'altra Mac (workflow de dues màquines) hauria de tenir també gRPC FUSE si replica aquest entorn Docker+OneDrive.

---

## Watchdog: la VM de Docker es penja (procés viu, daemon mort) — 2026-06-03

### Problema
Independentment del crash-loop del backend (que gRPC FUSE cura), la **VM de
Docker Desktop** es penja de tant en tant al Mac Intel 2014 amb el vault a
OneDrive: el procés "Docker Desktop" segueix **viu** però el daemon/VM està
**mort** (`docker ps` es penja o dóna `500 ... check if the server supports the
requested API version`; al log de la VM, `still dialing 192.168.65.7:2376: no
route to host`). Símptoma per a l'usuari: **tot Gnosi a 000**. Disparador
probable: estrès d'I/O de OneDrive (vist `GET /volumes` trigant 15,7 s) sobre
maquinari vell. No és OOM (la VM té 7,75 GiB i la memòria lliure és ~67%).

### Per què el `gnosi_boot.sh` no n'hi ha prou
`gnosi_boot.sh` només reaixeca Docker si `pgrep "Docker Desktop"` no troba res
(procés mort). En el cas "penjat" el procés segueix viu → no detecta res. A més
corre cada 6 h (massa espaiat per recuperar un penjat).

### Solució: `sh/docker_watchdog.sh` + LaunchAgent `com.gnosi.docker-watchdog`
LaunchAgent amb `StartInterval` curt (180 s) que comprova la salut REAL i, si el
daemon està penjat, fa `kill -9` dels processos Docker + `open -a Docker`.
Instal·lar amb `sh sh/install_docker_watchdog.sh` (portable, genera el plist amb
`$HOME`). Disseny anti-bucle/anti-fals-positiu (verificat):
- Camí ràpid: si `/api/health` respon, surt sense fer res.
- Només actua si el procés és VIU **i** `docker info` no respon (timeout casolà,
  perquè macOS no té `timeout` i el propi watchdog no es pengi).
- Si el daemon respon però el backend no → NO toca Docker (el backend es recupera
  sol via `restart: unless-stopped`).
- Cooldown de 300 s via stamp file → no reincideix mentre Docker arrenca (~90 s).
- Si Docker està parat del tot (procés absent) → NO actua (ho gestionen boot/usuari).

---

## Regla Crítica: Els Secrets d'Integracions Viuen al Volum Nomenat, MAI a l'Arbre Git — 2026-06-05

### Problema
Els calendaris (i el mail) de Google deixen de carregar de cop: `/api/calendar/calendars` torna `[]` amb HTTP 200 i **sense** capçalera `X-Calendar-Auth-Error`, i `/api/integrations` torna `{}`. Els events del *vault* (`provider:"vault"`) SÍ es veuen, cosa que despista. El backend està **sa** (`docker inspect gnosi_backend` → healthy, `RestartCount=0`): no és OneDrive dataless, ni crash-loop, ni Docker aturat.

### Causa
`integrations.json` (que guarda TOTES les credencials OAuth de Google) havia desaparegut. Vivia a `project_root/pipeline/private_skills/secrets/`, que al `docker-compose.yml` és un **bind mount dins l'arbre git** (`./pipeline/private_skills/secrets:/app/...`). El fitxer és gitignored → un `git clean -fdx`, una neteja o una reinstal·lació l'esborra, i el directori buit el recrea el `mkdir` del boot (`IntegrationManager.__init__`). Sense fitxer, `integration_manager._load()` → `{}` → `email_list` buit → cap calendari a consultar (ni error, perquè no hi ha res a autenticar). El `integration_manager` és singleton global i llegeix NOMÉS d'aquest fitxer (no toca Keychain).

### Regla
Els secrets per-instància (integracions, tokens) van al **volum nomenat `gnosi_local_data`** (`/app/data/secrets/`), com `management.sqlite` — `paths_config.py` ja ho documenta com a *"Local-only data (NEVER on cloud-synced storage)"*. **MAI** a l'arbre git (git clean) ni al vault/OneDrive (dataless/EDEADLK + tokens en clar al núvol).

- `SECRETS = local_data / "secrets"` a `paths_config.py`. Tots els consumidors (`integration_manager`, `mail_metadata_manager`, `google_calendar_service`) hereten via `cfg.paths["SECRETS"]`.
- Migració idempotent dins `get_paths`: copia l'`integrations.json` antic al volum si encara existeix i el nou no (cobreix l'altre Mac després d'un `git pull`).
- És **local per màquina** (no se sincronitza): es reconnecta un cop per Mac via Settings → Calendari → "Reconnecta Google" (`/api/auth/google/login?type=calendar`, repetir `type=email`) i ja no es perd. El client OAuth (`GOOGLE_OAUTH_CLIENT_ID/SECRET`) viu a l'entorn, NO a integrations.json.

### Per què NO al vault `.gnosi/` (sincronitzat per OneDrive)
Temptador per heretar les credencials a l'altre Mac sol, però: (1) OneDrive marca el fitxer `dataless` → EDEADLK en llegir-lo dins el contenidor (mateix patró que BD/registry/scheduler); (2) tokens en clar pujats al núvol; (3) en **mode organització** un vault pot ser compartit (`VaultAccess`) → els tokens d'una persona quedarien llegibles per tots els membres = fuga/suplantació, i hi ha múltiples vaults però el manager és singleton global. Si algun dia cal sync entre Macs, fer-ho per **git xifrat** (SOPS/git-crypt), no per OneDrive.

### Verificació
```bash
docker exec gnosi_backend python -c "from backend.config.app_config import load_params; print(load_params(strict_env=False).paths['SECRETS'])"
# → /app/data/secrets   (no /app/pipeline/...)
curl -s localhost:5002/api/auth/google/health   # configured:true (client OAuth a l'entorn, intacte)
# després de reconnectar: /api/calendar/calendars deixa de tornar []
```

### Causa-Efecte (memoritzar)
> Secrets a bind mount dins git → `git clean` esborra integrations.json → integration_manager `{}` → calendaris/mail de Google buits (però events del vault SÍ, i backend sa). Solució: SECRETS al volum nomenat `gnosi_local_data`, local per màquina, reconnectar un cop per Mac.

---

## Cas: warmup daemon VIU però els canvis de l'altre Mac no apareixen — 2026-06-16

### Símptoma
"El vault no s'actualitza amb els canvis de l'altra màquina (OneDrive)." Backend **healthy**, `RestartCount=0`, OneDrive corrent, **warmup daemon (5009) VIU**. Però `docker logs gnosi_backend -t --since 90s` s'omple de:
- `Error in partial read of /vault/BD/.../X.md: [Errno 35] Resource deadlock avoided`
- `No s'ha pogut llegir sidecar /vault/.gnosi/page_meta/<uuid>.json: [Errno 35] ...`

### Causa
Els canvis editats a l'altre Mac arriben per OneDrive com a **placeholders online-only** (`dataless`, `st_blocks==0`). El warmup daemon és **reactiu** (`GET /warmup?path=`), i els camins de lectura `partial read` (.md) i de **sidecars** `.gnosi/page_meta/*.json` **NO el criden** — només capturen l'`OSError` i continuen amb la còpia antiga. Resultat: el contingut nou no es llegeix mai. **Daemon viu ≠ fitxers hidratats.**

### Cura immediata (materialitzar host + restart)
1. Materialitzar des del HOST via daemon (fiable; `cat`/`read` directe fa *streaming* i NO baixa a disc) BD + page_meta:
   - enumerar `st_blocks==0` a `$VAULT/BD` i `$VAULT/.gnosi/page_meta` (amb `stat -f '%b'`, NO `find -flags dataless`), i per cada un `GET http://localhost:5009/warmup?path=<host_path>` **amb reintents** (sota ràfega el daemon torna 500 transitori per saturació del File Provider; un a un funciona).
2. `docker restart gnosi_backend` → reconstrueix índexs i persisteix la caché.
3. Verificar: `docker logs -t --since 90s | grep -c deadlock` → 0; `curl -H "X-User-ID: ismael-legacy" localhost:5002/api/vault/pages` → 200 amb la pàgina canviada i `last_modified`/`size` frescos (coincidents amb `stat` del host).

### Cura durable
Fixar a OneDrive **"Mantener siempre en este dispositivo"** (sistema en es_ES) les carpetes `BD/` i `.gnosi/` (Finder → botó dret). BD només fa **18 MB** → cost negligible. Elimina els online-only d'arrel. És **per-dispositiu**: repetir a cada Mac. Sense pin, OneDrive torna a deixar online-only cada canvi sincronitzat i el problema recurreix.

### Restriccions / Edge cases
- La caché del page_index es desa amb nom **per-vault**: `vault_page_index_<hash>.json` (NO `vault_page_index.json` pelat) → no és cap bug si el nom base no existeix.
- Alguns sidecars són **placeholders orfes** (esborrats al núvol/altre Mac): la lectura host **PENJA** (>6s) i el daemon torna **500 persistent** → runa de metadades; el backend els tolera (avisa i continua), no bloquegen.
- Comprovar SEMPRE que el **registry actiu** `BD/vault_db_registry.json` i `.gnosi/params.yaml` estiguin materialitzats (`stat -f '%b'`>0) — si no, BD/dashboard buits o crash-loop a l'arrencada.
- Runa de conflictes OneDrive a `.gnosi/`: `scheduler_config-MacBook Pro de Ismael (2)-N.json` (146 vistos) — netejable, no urgent.

### Causa-Efecte (memoritzar)
> Canvi a l'altre Mac → OneDrive el deixa online-only (`dataless`) aquí → camins partial-read/sidecar NO criden el daemon 5009 → EDEADLK → contingut vell. Cura: materialitzar BD+page_meta via daemon + `restart backend`; durable: pin "Mantener siempre en este dispositivo" a BD/ i .gnosi/.

### ⚠️ Efecte secundari verificat (2026-06-17): reiniciar OneDrive PENJA Docker
Reiniciar la pila del File Provider de OneDrive (`quit OneDrive` + `killall fileproviderd` + reobrir) — fet per intentar reclamar els ~53 GB orfes del magatzem `OneDriveStandaloneSuite/OneDrive - UNED.noindex` (107 GB; recurrència del duplicat de 103 GB; el disc estava al 98-99%) — **va tombar la VM de Docker** (socket `docker.sock` desaparegut, `com.docker.backend` viu però daemon mort). És el mateix patró d'estrès d'I/O del watchdog: OneDrive reconcilia a fons (vist **140% CPU**) just quan Docker re-munta el path via gRPC FUSE → penjada.
- **Recuperació (≈4-5 min):** `pkill -9 -f com.docker` + `pkill -9 -f "Docker Desktop"` → `open -a Docker` → esperar ~90 s el daemon → els contenidors tornen sols (`restart: unless-stopped`). El backend triga després **uns minuts més** a servir perquè el walk de l'índex (78k fitxers del vault) va ofegat mentre OneDrive segueix a ~70-80% CPU; NO està penjat (CPU ~40%, `RestartCount=0`, 0 deadlocks) — només cal esperar que OneDrive baixi.
- **Lliçó:** "reiniciar OneDrive" NO és una acció innòcua amb aquesta pila; planifica que Docker caurà i caldrà recuperar-lo, i fes-ho amb finestra. La reclamació dels 53 GB és **gradual** (OneDrive evicta en segon pla; no salta de cop). El watchdog `com.gnosi.docker-watchdog` també ho hauria recuperat sol en ≤3 min.

---

## PROJECTE: migrar Gnosi a NATIU (treure Docker) — pla + blocaire de disc (2026-06-17)

### Per què
L'`EDEADLK` i tot el ball de materialitzar/pin existeix NOMÉS perquè el backend llegeix el vault de OneDrive des de **dins de Docker** (gRPC-FUSE no dispara la hidratació on-demand del File Provider). Obsidian/Office no pateixen perquè llegeixen **natiu al host**. Solució d'arrel decidida amb Ismael: **córrer backend + frontend natius, sense Docker.** Llavors el vault es pot deixar online-only (estalvi de disc), mor el warmup daemon i mor el risc de penjada de Docker.

### Reconeixement Phase 0 (fet 2026-06-17)
- ✅ Homebrew (`/usr/local/bin/brew`, Mac Intel), Node v26 + npm 11, `mkcert` i **certs HTTPS ja existents** (`frontend/certs/localhost.pem` + `-key.pem`).
- ⚠️ **Python 3.11 NO instal·lat** (sistema = 3.9.6) → `brew install python@3.11`.
- ⚠️ Ollama (:11434, `AI_MODEL_URL`) NO escolta → l'IA local potser ja està morta (o s'usa API: anthropic/groq/openai a `requirements.txt`). No bloca la migració.
- 🔴 **BLOCAIRE: disc 98% ple (~5,3 GB lliures).** L'entorn Python (torch via `sentence-transformers`) + `node_modules` (frontend pesat: tldraw/blocknote/fullcalendar) = ~3-4 GB, + baixada de models on-first-use 1-2 GB. Docker NO té res recuperable segur (16,9 GB d'imatges actives = el fallback; build cache 0). **No es pot instal·lar amb seguretat.** Cal alliberar ~10-15 GB primer: el reset de OneDrive (53 GB, **necessita sign-in de l'usuari**) o sacrificar el fallback Docker (no abans que el natiu funcioni).

### Runbook (executar quan hi hagi ~15 GB lliures; principi: NO desmuntar Docker fins que el natiu passi QA)
1. **Prereqs:** `brew install python@3.11 pandoc`. ⚠️ **pandoc és dependència del HOST en natiu** (la imatge Docker el duia; sense ell, l'export de pàgines i tot el flux de cites moren amb 500). Instal·lat 2026-07-06 (PR #731); el codi el resol via `_pandoc_bin()` (PANDOC_PATH → which → rutes Homebrew), així que un LaunchAgent amb PATH mínim també el troba. El format `pdf` a més necessita `pdflatex` (MacTeX) — pendent/opcional.
2. **Dades:** copiar del volum `gnosi_local_data` (només 31 MB; `cache/` 29 MB es regenera) → carpeta host (p. ex. `monorepo/apps/gnosi/local_data/`). Crític: `secrets/` (tokens OAuth), `tool_registry.sqlite`, `system/`, `local_file_links.json`. `management.sqlite`/`checkpoints.sqlite` buits.
3. **Backend natiu:** `python3.11 -m venv .venv && .venv/bin/pip install --no-cache-dir -r requirements.txt`. `.env` amb: `DIGITAL_BRAIN_VAULT_PATH=<ruta host del vault>` (NO `/vault`), data dir = carpeta nova, `TRANSLATION_SERVER_URL=http://localhost:1969` (o buit → degrada bé), `AI_MODEL_URL` a localhost, `PYTHONPATH=monorepo/apps/gnosi`. Aturar Docker (port 5002) i `.venv/bin/uvicorn backend.server:app --port 5002`. PROVA DE FOC: `/api/vault/pages` ha de llegir online-only **sense EDEADLK** (és el sentit de tot).
4. **Frontend natiu:** `cd frontend && npm install && npm run dev` (5173 HTTPS, certs ja hi són). El guard `predev` bloca si el contenidor `gnosi_frontend` viu → cal Docker frontend aturat. Apuntar `VITE_BACKEND_*` a localhost:5002.
5. **translation-server: ES DEIXA FORA** (Ismael no el té a l'altre Mac; només és captura web de referències via `/translate-url`, degrada bé). Docker 0%.
6. **QA** funció per funció vs Docker (BD, dashboard, mail, calendari, cerca/cites, traducció es↔fr).
7. **Decommission** (només si QA passa): reescriure `com.gnosi.boot` per arrencar serveis natius (LaunchAgent uvicorn + vite); **eliminar `com.gnosi.docker-watchdog` i `com.gnosi.onedrive-warmup`** (ja no calen); `docker compose down` (SENSE `-v`); recuperar 16,9 GB d'imatges + Docker.raw; actualitzar CLAUDE.md (fi de la doctrina "Docker first").

### ✅ Mètode SEGUR per reiniciar OneDrive (sense penjar Docker) — 2026-06-17
El `killall fileproviderd` és el que va tombar Docker (mata el mount que Docker re-munta). A més, va deixar el procés principal de OneDrive **espinejant 10 h al 113% CPU sense xarxa** (bucle local, no sync) i sense reclamar res. **Mètode correcte:** reiniciar NOMÉS l'app de OneDrive, deixant `fileproviderd` i la File Provider extension vius (així el mount es manté i Docker no pateix):
1. `osascript -e 'tell application "OneDrive" to quit'`; si l'spinner no respon (no ho fa: ignora quit i SIGTERM), `kill -9 <PID exacte del procés .../MacOS/OneDrive>` — NO `killall fileproviderd`, NO matar `OneDrive File Provider.appex`.
2. `open -a OneDrive`.
3. Verificat: Docker es manté `healthy` tot el temps, l'spin desapareix (procés nou a ~45-70% fent reconcile REAL), i el disc **va alliberant** (4,7 → 7,9 GB en minuts; la instància nova evicta orfes de debò, l'encallada no). Si cal recuperar els 53 GB sencers, el reset complet del magatzem (tancar sessió + refer .noindex) segueix sent l'última opció, amb finestra.
