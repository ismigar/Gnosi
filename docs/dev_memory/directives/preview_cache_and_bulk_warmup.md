# Directive: Preview Cache + Bulk Warmup al Backend

## Objectiu
Servir `/api/vault/pages/<id>/preview` en mil·lisegons fins i tot quan
el `.md` viu a OneDrive en mode online-only. Sense aquest patró, cada
preview tardava ~4.55 s (cua de retries amb backoff en errno 35 mentre
el File Provider d'OneDrive materialitzava el fitxer) → un feed de 77
entrades trigaria més de 5 minuts en serial.

## Abast
- `monorepo/apps/gnosi/backend/api/vault_routes.py`:
  - `_preview_cache` (Map mtime-invalidated, LRU real amb `OrderedDict`).
  - `_preview_inflight` (dedup d'in-flight per id).
  - `_fetch_preview_with_cache(file_path, page_id)` — el punt d'entrada únic.
  - `bulk_warm_previews` — endpoint `POST /api/vault/pages/preview/warm`.
- Frontend (`DbViewEmbed.jsx`, `FeedRender`): un sol POST fire-and-forget
  al bulk warmup en muntar la vista.

## Protocol d'implementació
1. **Cache per id, invalidat per mtime del `.md`**. Mai TTL fix. Si el
   contingut canvia → mtime canvia → cache miss → re-llegim. Mida
   limitada (1000 entrades) amb `OrderedDict.move_to_end` a cada hit
   per LRU real (no FIFO d'inserció).
2. **Warmup proactiu abans del read**. Si el fitxer és online-only
   (`provider.is_online_only(p, st)`), cridar `provider.materialize(p)`
   abans del `read_text` per evitar la cua de retries `errno 35`.
3. **Dedup d'in-flight**. Dues peticions concurrents pel mateix id
   comparteixen la mateixa `asyncio.Future` per no duplicar feina
   contra OneDrive. Cleanup garantit amb `finally`.
4. **Endpoint bulk** que rep `{ ids: [...] }` i dispara
   `_fetch_preview_with_cache` en paral·lel (semàfor 8). Resposta amb
   comptadors `requested/cached/warmed/failed`.
5. **Per-item timeout al bulk** (`asyncio.wait_for`, 30 s). El daemon
   té el seu propi `ONEDRIVE_WARMUP_TIMEOUT` (90 s) però el backend
   imposa un límit superior coordinat — un sol id penjat no pot
   bloquejar el batch.
6. **Frontend**: `useEffect` a `FeedRender` que crida un sol POST al
   bulk warmup quan canvia el `rowsSignature`. Fire-and-forget; si
   falla, els fetches individuals (eager o IO-lazy) cauen al patró
   estàndard del `/preview` GET.

## Restriccions i casos límit
- **`allow_full_scan=False` al `find_page_path` del bulk**. Un id orfe
  (vista stale apuntant a un fitxer ja eliminat del disc) ha de fallar
  ràpid en lloc d'iniciar un `rglob` ple del vault. La pàgina existent
  sempre és a l'index, així que `allow_full_scan=False` és segur.
- **El cache és per-procés**. Reiniciar Docker el buida i la primera
  crida torna a pagar el cost. Acceptat com a tradeoff de simplicitat.
  Si es vol persistir, escriure-ho a `<vault>/.gnosi/preview_cache/`
  amb el mateix mtime check.
- **Cap canvi al format de resposta del `/preview` existent**. La
  resposta segueix sent `{ id, title, excerpt, icon, cover, body_md?,
  images? }`. Els callers (`FeedItem`, `WikilinkHoverPreview`, etc.)
  no han de canviar res.
- **Race benigna en escritura concurrent**: dos requests pel mateix id
  amb cache miss simultani escriuen el mateix valor — no és problema.

## Validació
1. `python -m py_compile backend/api/vault_routes.py` ✓
2. `vite build` ✓ al frontend
3. Test funcional curl:
   - Bulk warmup amb id viu: retorna `{requested:1,cached:0,warmed:1,failed:0}` en pocs segons (primer cop) i `{requested:1,cached:1,...}` instantani (segon).
   - `GET /preview` directe després del warmup: < 100 ms (era ~5 s).
   - Bulk amb id orfe: `{requested:1,...,failed:1}` en ms (no segons).

## Per què (decisió arrel)
Abans d'aquest patró, hi va haver intents de mitigar el problema al
**frontend** amb hidratació eager + dedup + retry (PRs #112 i #113).
Tots dos van ser revertits a #114 perquè no atacaven la causa arrel:
**no hi havia cache al backend ni es warmupava proactivament**.

El patró fix és **sempre atacar al lloc on el coll d'ampolla viu**.
Aquí: el coll viu al backend (warmup serialitzat d'OneDrive),
qualsevol pegat al frontend és malbarataç.

## PRs relacionades
- #115 (`feat(vault/preview)`) — cache + bulk warmup base
- #116 (`fix(vault/preview)`) — robustesa: orfes, timeouts, LRU real,
  in-flight dedup
