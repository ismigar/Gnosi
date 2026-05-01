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
