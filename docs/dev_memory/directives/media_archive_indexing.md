# Directiva: Indexació de l'Arxiu Fotogràfic (MediaCenter)

## Context
La pàgina `MediaCenter` (`/media`) llista fotos de `VAULT/Images`. El vault de
producció viu a OneDrive amb ~56k imatges en ~99 subcarpetes (àlbums); això és
un cas qualitativament diferent al d'un FS local i imposa restriccions
fortes sobre com cal indexar.

## Problema observat
1. L'arxiu apareixia buit en obrir-lo.
2. Clicar "Totes les fotos" provocava timeout (>60s) sense resposta.

Diagnòstic:
- El frontend s'inicialitzava amb `activeAlbum = 'General'`. La carpeta `Images/General`
  està buida → la primera vista era "0 fotos" tot i tenir 56k a la resta d'àlbums.
- El servei feia `rglob("*.*")` + `path.stat()` separat per ordenar 56.829 fitxers.
  Cada `Path.stat()` a OneDrive és una crida separada (no comparteix res amb el
  llistat) i, amb fitxers possiblement online-only, costa centenars de ms cada un.
  Resultat real: passada superior a 60s i sovint amb timeout del client.
- `fetchAlbums()` estava definit però no es cridava mai (faltava el `useEffect`),
  així que la sidebar només mostrava "Totes les fotos" sense els àlbums reals.
- La ruta `GET /media` no propagava `limit`/`offset` al servei: la paginació
  del frontend s'ignorava silenciosament (sempre `offset=0`).

## Restriccions / Edge Cases
- **No fer `Path.rglob` + `Path.stat()` sobre OneDrive amb desenes de milers
  de fitxers**: cada `stat` és una crida cloud-aware separada → temps no-lineal.
  Usar `os.scandir` recursiu i llegir `entry.stat().st_mtime` (compartit amb el
  listing). Estalvi: ~50% del temps a OneDrive.
- **Encara amb scandir, una passada freda triga ~25–40s amb 56k fitxers**.
  És inevitable a OneDrive: cal cache en memòria (TTL recomanat: 5 min) per
  evitar repetir-la a cada paginació o canvi de viewport. Invalidar el cache
  a `upload_media` (i en qualsevol mutació) o l'usuari no veurà els seus uploads.
- **`General` no és un bon defecte**: el frontend l'havia de crear per
  consistència però sol estar buit. Defecte sa: `activeAlbum = null`
  (= "Totes les fotos"), que activa el path cachat.
- **Defecte d'axios = 0 (sense timeout) a v1, però `0` ≠ "infinit" en alguns
  proxies/Vite**: per a la primera indexació calenta posar `timeout: 300000`
  explícitament al `axios.get` del fetch de `/media`.
- **Noms d'àlbum amb espais o caràcters Unicode**: cal `encodeURIComponent`
  al construir l'URL del frontend o el FastAPI rep paràmetres truncats.
- **HTTP/1.1 i 50 thumbs en grid**: el navegador limita a 6 connexions per host;
  amb fotos de >1MB es percep com "lent". `loading="lazy"` n'és la mitigació
  natural però cal verificar que les primeres files del grid siguin al viewport
  inicial; si no, l'usuari veu cards buides fins que faci scroll.

## Codi de referència
- Servei: `monorepo/apps/gnosi/backend/services/media_service.py`
  - `_scan_recursive` (os.scandir)
  - `_scan_with_cache` + `_scan_locks` (TTL 5 min, lock per `target_dir`)
  - `invalidate_cache(target_dir|None)` cridat des de `upload_media`
- Ruta: `monorepo/apps/gnosi/backend/api/vault_routes.py` (`/media`)
  - Propaga `limit`, `offset` a `media_service.get_all_media`
- UI: `monorepo/apps/gnosi/frontend/src/pages/MediaCenter.jsx`
  - `useState(null)` per a `activeAlbum`
  - `useEffect(() => fetchAlbums(), [])` (faltava)
  - `axios.get(url, { timeout: 300000 })`
  - `encodeURIComponent(activeAlbum)` al construir la URL

## Verificació
1. Backend reiniciat: primer `GET /api/vault/media?limit=10&offset=0` → ~25–40s.
2. Següents crides (mateix `target_dir`) → <1s.
3. `GET /api/vault/media/albums` → llista de 99 àlbums.
4. UI a `localhost:5173/media`: sidebar amb "Totes les fotos" + 99 àlbums,
   grid amb les primeres 50 fotos, paginació disponible. Total reportat:
   `56.829`.

## Treball futur (no fet aquí)
- Persistir l'índex (SQLite o JSON al `gnosi_local_data` volume) per evitar la
  passada freda en cada reinici del backend.
- Indexació en background a l'arrencada (no fer esperar el primer client).
- Considerar la Fototeca iPhoto migrada (`Fototeca iPhoto.migratedphotolibrary`)
  com un cas a part: 1342 fitxers ja inclosos en el comptador però amb
  estructura interna pròpia que potser no és el que l'usuari vol veure barrejat.

## Servit d'imatges (`GET /api/vault/images/...`) — restriccions OneDrive

Després d'arreglar la indexació, els thumbnails apareixien en negre. Diagnòstic:

- **Fitxers OneDrive online-only**: tenen `st_size > 0` (mida lògica del cloud)
  però `st_blocks == 0` (cap dada local). Llegir-los des del bind-mount Docker
  del Mac dispara repetidament `OSError [Errno 35] Resource deadlock avoided`,
  per molts retries que es facin. El File Provider d'OneDrive només dispara
  la baixada si la lectura es fa **des del host** (Finder, `cat`, qualsevol
  procés natiu del Mac). Des de dins el contenidor, el grpcfuse de Docker no
  propaga el trigger.
- **Concurrència**: encara que estiguin materialitzats, lectures simultànies
  sobre OneDrive també poden provocar Errno 35. Cal serialitzar amb un
  `asyncio.Semaphore(3)` global + retry exponencial (0.2/0.4/0.8/1.6 s) per
  Errno 35 al `open(); read(1)` warm-up abans del `FileResponse`.

### Daemon de warmup al host (solució "descarrega al vol")

`sh/onedrive_warmup_daemon.py` és un servei HTTP minimalista que:
- Escolta a `0.0.0.0:5009` al **host** (Mac).
- Endpoint `GET /warmup?path=<absolute_host_path>`.
- Llegeix el fitxer sencer (això **bloqueja** fins que el File Provider acaba
  la baixada — és un dataless-file, `read()` sincronitzat amb sync).
- Retorna `{"status":"materialized","blocks":N,"elapsed":s}` o `timeout`/`notfound`.
- Confina les peticions a `VAULT_HOST_PATH` per seguretat.

Llançar-lo: `sh/start_warmup_daemon.sh --bg` (PID a `/tmp/onedrive_warmup_daemon.pid`,
log a `/tmp/onedrive_warmup_daemon.log`).

### Integració al backend

A `serve_vault_image`, quan `st_blocks == 0`:
1. Demana materialització a `http://host.docker.internal:5009/warmup`.
2. Coalescing: peticions simultànies pel mateix fitxer comparteixen un `Future`.
3. Semàfor `_WARMUP_SEMAPHORE = 2`: més paral·lelisme satura el File Provider.
4. Si el daemon retorna `materialized`, refrequem `stat()` i continuem.
5. Si falla (timeout, daemon parat), retornem **410 Gone** amb missatge.

### Latències observades (perfil OneDrive d'aquest setup, ~5 MB per foto)

- Fitxer ja al disc: ~80–120 ms.
- Warmup primer cop (un fitxer): 15–45 s (depèn de l'amplada de banda d'OneDrive).
- Warmup primer cop (5 fitxers en paral·lel, semàfor=2): ~80–120 s en total.
- Després de materialitzar, l'arxiu queda a disc i les crides futures són
  instantànies. El frontend ho percep com una primera càrrega lenta i després
  fluidesa total.

### UX

`MediaCenter.jsx` substitueix la imatge en error per una icona `cloud-off` amb
text "No descarregat", de manera que els thumbnails que encara estan baixant
(o que no s'han pogut materialitzar) mostren una indicació clara.

### Restriccions / Edge cases
- Si `st_blocks` no està disponible al filesystem, `getattr(st, "st_blocks", 1)`
  per defecte fa que la lectura prossegueixi normal.
- El daemon **NO** ha d'arrencar dins de Docker: la seva utilitat és precisament
  cridar el File Provider, que viu al host.
- Si `host.docker.internal` no resol (Linux pur), el warmup retorna excepció;
  el backend degrada a 410 i el frontend mostra "No descarregat". El sistema
  no es trenca, només deixa de "descarregar al vol".
- El daemon usa `ThreadingHTTPServer` però limita la concurrència real al host
  per la naturalesa serialitzada del File Provider d'OneDrive (proves: ~1.5×
  més lent amb 4 paral·lels que amb 2).
