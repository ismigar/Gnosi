# Directive: I/O del vault dins handlers async (no bloquejar l'event loop)

## Símptoma
L'app sencera "es penja": en obrir una secció (Calendari, Lector, Graf) el
spinner no acaba, i a partir d'aquell moment **qualsevol** petició a l'API fa
timeout (encua), encara que altres endpoints siguin trivials. El backend NO
cau (health=healthy, RestartCount=0).

## Causa
Un handler `async def` fa **I/O bloquejant** directament (no dins
`asyncio.to_thread`): típicament `vault_path.rglob("*.md")` + `read_text()`
sobre milers de fitxers del vault de OneDrive. Molts són **online-only**
(`Mail/` en té ~8700 amb `st_blocks==0`); cada `read_text` força una descàrrega
de OneDrive (segons, o `Errno 35`). Com que corre a l'event loop, **bloqueja
TOTES les corutines** → l'app sencera deixa de respondre fins que acaba (minuts).

Cas real (2026-06-01): `GET /api/calendar/events` → `_get_vault_events` feia
`rglob` + `read_text` sobre els 11.690 `.md` del vault a l'event loop. Vegeu
`api/calendar_routes.py`. `reader/sources` i `graph` "penjaven" en cascada
NOMÉS perquè l'event loop estava bloquejat per calendar (ells anaven bé directe).

## Regla
Tot handler `async def` que toqui el vault:
1. **Embolcalla la feina d'I/O amb `await asyncio.to_thread(fn, ...)`** — mai
   `rglob`/`read_text`/`open` directament al cos async.
2. **No llegeixis tot el vault.** Exclou carpetes enormes/irrellevants
   (`Mail`, `Images`, `Assets`, `.git`, `.gnosi`, `node_modules`). Reutilitza
   `get_markdown_files_efficient()` (`services/graph_service.py`) o un walk amb
   poda de directoris.
3. **Salta fitxers online-only** abans de llegir-los: `st = p.stat();
   if getattr(st, "st_blocks", 1) == 0: continue` — no forcis descàrregues
   bloquejants (el warmup proactiu / on-demand ja s'encarrega de materialitzar).
4. **Caça externa amb timeout.** Crides a Google/CalDAV/IMAP dins `to_thread`
   amb `timeout=` explícit (p. ex. client Google a `google_calendar_service.py`
   sense timeout penja si el token és invàlid).

## Diagnòstic (com es va trobar)
```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
# 1. Backend directe (5002) vs proxy Vite (5173): si directe va ràpid i proxy
#    penja, l'event loop estava bloquejat per una crida anterior.
curl -s  -o /dev/null -w "%{http_code} %{time_total}s\n" http://localhost:5002/api/<ep>
curl -sk -o /dev/null -w "%{http_code} %{time_total}s\n" https://localhost:5173/api/<ep>
# 2. Threaddump del WORKER (NO PID 1: amb --reload, PID 1 és el supervisor
#    watchfiles; el worker és el fill spawn_main de multiprocessing).
docker exec gnosi_backend sh -c 'command -v py-spy || pip install -q py-spy'
docker exec gnosi_backend sh -c 'ps -eo pid,ppid,cmd | grep spawn_main'
docker exec gnosi_backend py-spy dump --pid <worker_pid>
# 3. Mesura components aïllats per descartar (load_params, get_all_safe...).
```

## Restriccions / Edge cases
- **`networkidle` de Playwright no és fiable** amb Vite (HMR websocket sempre
  actiu); no l'usis per esperar contingut (vegeu SKILL playwright_e2e §6.2).
- Els `.db` operatius (management.sqlite, vault_dbs/) viuen a `local_data`, NO
  al vault → llegir-los NO penja. El problema és sempre el vault de OneDrive.
- `calendar/events?include_vault=true` encara triga ~11s (llegeix ~2939 `.md`
  reals fora de `Mail/`). Millora futura: indexar (usar el `page_index` cachejat)
  en lloc de llegir cada fitxer.

## Causa-Efecte (memoritzar)
> Handler `async` + `rglob`/`read_text` del vault OneDrive (online-only) a
> l'event loop → bloqueja TOTES les peticions → l'app sencera penja. Sempre
> `asyncio.to_thread` + excloure carpetes pesades + saltar online-only.
