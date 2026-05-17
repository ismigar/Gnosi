# Directive: Patró de Warmup d'OneDrive per a Qualsevol FileResponse

## Objectiu
Qualsevol endpoint del backend que serveixi un fitxer físic via
`FileResponse(path=...)` ha de gestionar el cas online-only d'OneDrive
ABANS d'enviar els headers. Sense això, FastAPI envia `200 OK` i quan
prova de streamejar el contingut peta amb `Errno 35 (Resource deadlock
avoided)` mid-stream → el navegador rep una resposta truncada i el
fitxer no s'obre.

## Abast
Qualsevol nou endpoint a `monorepo/apps/gnosi/backend/api/vault_routes.py`
del tipus:
```python
@router.get("/some-file-path/{token_or_path}")
async def serve_X(...):
    p = Path(abs_path)
    ...
    return FileResponse(path=str(p), ...)  # ← aquí el bug si p és online-only
```

Llocs on el patró JA està aplicat (per copy-reference):
- `_serve_file_with_containment` (Assets/Images, vault/raw) — patró original.
- `serve_local_file` (`/api/vault/local-file/{token}`) — afegit a #117.

## Protocol d'implementació
Abans del `FileResponse`:

```python
# 1. Warmup proactiu si online-only
try:
    provider = get_files_provider()
    st = p.stat()
    if provider.is_online_only(p, st):
        await provider.materialize(p)
        try:
            st = p.stat()
        except OSError:
            raise HTTPException(503, "File temporarily unavailable",
                headers={"Cache-Control": "no-store, must-revalidate"})
        if provider.is_online_only(p, st):
            raise HTTPException(503, "File warmup pending; try again",
                headers={"Cache-Control": "no-store, must-revalidate"})
except HTTPException:
    raise
except Exception as e:
    log.debug(f"Warmup proactiu per {p} ha fallat: {e}")
    # Continuem: el 1-byte probe següent gestionarà errors residuals.

# 2. 1-byte probe amb backoff (estabilitza el handle abans del stream)
last_error = None
for attempt in range(5):
    try:
        with open(p, "rb") as f:
            f.read(1)
        last_error = None
        break
    except OSError as e:
        last_error = e
        if e.errno == 35 and attempt < 4:
            await asyncio.sleep(0.2 * (2 ** attempt))
            continue
        break
if last_error is not None:
    raise HTTPException(503, "File temporarily unavailable; try again",
        headers={"Cache-Control": "no-store, must-revalidate"})

# 3. Ara sí, FileResponse
return FileResponse(path=str(p), media_type=media_type)
```

## Restriccions i casos límit
- **Headers `Cache-Control: no-store, must-revalidate` als 503**.
  Sense això, Chrome guarda els 503 al disk cache i el fitxer queda
  "trencat" indefinidament al navegador fins a un hard refresh.
- **Mai retornar 200 OK abans del 1-byte probe**. Si retornem `200`
  abans i el body peta, el navegador rep una resposta corrupta i el
  contingut no s'obre. El probe garanteix que el handle estigui llest
  abans d'enviar res al client.
- **Backoff exponencial 0.2 → 0.4 → 0.8 → 1.6 s (4 intents)** és el
  mateix patró que `_serve_file_with_containment` per a Assets.
  Mantenir consistència entre endpoints.

## Per què
Errno 35 (`EAGAIN`/Resource deadlock avoided) ve del macOS File Provider
d'OneDrive quan un fitxer és "online-only" (placeholder al disc, contingut
al núvol). Cal demanar la materialització abans de llegir.

## Validació
Verificació empírica per a un fitxer online-only:
```bash
# Abans del fix → 200 OK mid-stream-error, log "❌ Unhandled exception"
curl -v "http://localhost:5002/api/vault/<endpoint>" | wc -c
# → bytes count truncats; user opens nothing.

# Després del fix → primer cop 503 (warmup en curs) o triga uns segons,
# però responde correctament. Segon cop instantani.
```

## PRs relacionades
- #117 (`serve_local_file`) — afegir el patró a l'endpoint d'enllaços `file://`
- Patró original a `_serve_file_with_containment` (Assets/Images)
