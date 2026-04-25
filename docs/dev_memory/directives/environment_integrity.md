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
- El frontend SÍ usa hot-reload via volum, per tant `restart` o `up -d` sense `build` és suficient per al frontend.
