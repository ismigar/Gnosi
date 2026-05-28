# Environment Integrity Directive (Docker vs Local)

## Objective
Prevent development environment fragmentation where multiple instances of the same service run simultaneously (e.g., Docker frontend on 5173 and Local frontend on 5174).

## Constraints
1. **Port Lockdown**: The frontend MUST ALWAYS run on port `5173`. 
2. **Anti-Ghosting**: If port `5173` is occupied by a Docker container, you MUST NOT start a local `npm run dev` that jumps to `5174`.
3. **Priority**: Docker always has priority. Local services are only allowed if Docker is explicitly stopped for deep debugging.

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
