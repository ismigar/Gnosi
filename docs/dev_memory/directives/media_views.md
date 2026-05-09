# Directiva: Vistes amb filtres i ordenació al MediaCenter

## Context

Avui `MediaCenter` (`/media`) només organitza per **carpetes** (lazy tree) i
filtra al client per nom de fitxer. L'ordenació és fixa a `mtime desc` (server).
Volem afegir, en paral·lel a les carpetes, **vistes** amb filtres i ordenació
configurables (estil VaultViews del Vault).

Pla acordat amb l'usuari (proposta de la sessió 2026-05-09):

- **F1** — Filtres barats + sort + persistència de metadades (tags/descripció).
  No persisteix vistes encara: tot l'estat viu al component.
- **F2** — Índex EXIF persistit per fer `date_taken`/`has_gps` viables sobre
  desenes de milers de fitxers a OneDrive.
- **F3** — CRUD de "vistes" (sidebar nova, modal de configuració, vistes built-in).
- **F4** — Agrupació timeline (dia/mes/any) i facets per al selector de tags.

Aquesta directiva cobreix **F1**.

## Bug col·lateral detectat (resol F1)

`PATCH /vault/media/metadata` (a `vault_routes.py:3692`) crida
`media_service.update_metadata(filename, album, metadata)`, però aquest mètode
**no existeix** a `MediaService`. El resultat avui és `AttributeError → HTTP 500`
i el botó "Desar" del details panel falla en silenci (toast "Error en desar").

F1 implementa `update_metadata` perquè la capa de filtres per tags té sentit.

## Decisions

### Persistència de metadades d'usuari (tags + descripció)

- **Format**: un únic JSON atòmic a `vault/.gnosi/media_metadata.json`.
- **Clau**: path relatiu al **root actiu** (no només filename — el mateix nom es
  repeteix entre àlbums) en POSIX (`Viatges/2026/IMG_001.jpg`). El root forma
  part de la clau composta: `images::Viatges/2026/IMG_001.jpg`.
- **Estructura**:
  ```json
  {
    "version": 1,
    "items": {
      "images::Viatges/2026/IMG_001.jpg": {
        "tags": ["viatge", "italia"],
        "description": "...",
        "updated_at": "2026-05-09T..."
      }
    }
  }
  ```
- **Per què al vault i no a `~/.cache/gnosi/`**: són **dades d'usuari**, no cache.
  Han de sincronitzar entre dispositius via OneDrive. La regla "caches fora
  d'OneDrive" no aplica a dades semàntiques de l'usuari.
- **Per què JSON únic i no SQLite**: SQLite a OneDrive té problemes coneguts de
  locks/sync. Un JSON <5MB per ~33k entrades es carrega en <100ms i s'escriu
  atòmicament (write-temp-then-rename). Tradeoff acceptat.
- **Carrega**: una sola vegada a la inicialització (lazy, primer `update_metadata`
  o primer filtre per tags) i es manté en memòria amb un `RLock`.
- **Escriptura**: `tempfile.NamedTemporaryFile` al mateix directori + `os.replace`.

### Filtres a F1 (backend)

| Param | Valors | Cost | Notes |
|---|---|---|---|
| `kinds` | csv: `image,video,audio,pdf,other` | barat | filtra per `classify_kind(ext)` |
| `extensions` | csv: `jpg,png,...` | barat | sense punt; comparació `ext.lstrip('.')` |
| `q` | string | barat | substring case-insensitive sobre filename |
| `desc_contains` | string | barat (memòria) | substring sobre `description` del sidecar |
| `tags_any` | csv | barat (memòria) | OR |
| `tags_all` | csv | barat (memòria) | AND |
| `tags_none` | csv | barat (memòria) | NOT |
| `size_min` / `size_max` | int (KB) | barat | sobre `st.st_size` |
| `mtime_from` / `mtime_to` | ISO date | barat | sobre `st_mtime` |
| `sort` | `mtime` (def) \| `filename` \| `size` \| `kind` | barat | |
| `dir` | `desc` (def) \| `asc` | barat | |

**Fora de F1** (queden per F2):
- `date_taken_from/to`, `has_gps`, `sort=date_taken` — necessiten EXIF, que avui
  només es llegeix amb `fast=False` (obre el fitxer). Sobre OneDrive amb 56k
  fitxers això és inviable sense índex previ.

### Filtres a F1 (frontend)

- Una **toolbar** nova entre `<header>` i el grid quan hi ha àlbum/root actiu:
  - Pills de `kind` (Imatges / Vídeos / PDFs / Audio / Altres) toggle múltiple.
  - Selector de **rang de dates** (`mtime`) amb presets (Avui, 7d, 30d, Aquest any, Tot, Personalitzat).
  - Input de **tags** amb autocomplete bàsic (lliure a F1, sense facets backend).
  - Selector de **mida** (Petites <500KB / Mitjanes / Grans >5MB / Personalitzat).
  - Selector d'**ordenació** (camp + asc/desc).
  - Botó "Netejar filtres".
- Estat local al component (`useState`), serialitzat als query params del fetch.
- Un debounce 250ms per inputs de text (q, tags) abans de re-fetch.

## Restriccions / Edge cases

- **Cost EXIF**: NO afegir filtres EXIF a F1. Si l'usuari demana sort per
  `date_taken`, deshabilitar l'opció amb tooltip "disponible a F2".
- **Paginació post-filtre**: amb filtres aplicats, el `total` retornat és el
  total de l'**índex filtrat**, no el del directori sencer. La UI ja mostra
  `media.length / total` com a "Carregades / Coincidents".
- **Cache d'escaneig**: els filtres s'apliquen sobre `_scan_with_cache` ja
  existent — no toquem la cache. La invalidació segueix igual (uploads).
- **Tags case-sensitivity**: tots els tags es normalitzen a `lower().strip()`
  tant en escriure com en filtrar. Evita duplicats "Viatge" vs "viatge".
- **OneDrive `st_blocks==0`**: no obrim els fitxers per filtrar. Els fitxers
  online-only mostren tags/descripció buits (no pot ser d'altra manera fins F2).
- **Concurrència**: el sidecar JSON té un únic `RLock`. Lectura/escriptura
  bloquegen, però són operacions <50ms.
- **Migració**: no cal — fitxer creat al primer write. Si no existeix, totes
  les entrades són `{}`.

## QA

1. `docker-compose up -d --build backend` → `pytest backend/tests` (mediaservice si existeix).
2. UI manual a `localhost:5173/media`:
   - Selecciona un àlbum amb >50 fotos.
   - Aplica filtre `kinds=image` → veu només imatges.
   - Aplica filtre `mtime_from=avui-30d` → llistat reduït.
   - Edita tags d'una foto, desa, i comprova que `vault/.gnosi/media_metadata.json` conté l'entrada.
   - Filtra per aquell tag → la foto apareix.
   - Canvia sort a `filename asc` → ordenació alfabètica.
3. `pkill -f vite && cd monorepo/apps/gnosi/frontend && npm run build` → 0 errors.
4. Browser smoke test del flux complet (cal screenshot — limitació real).

## Codi tocat per F1

- **Backend**:
  - `monorepo/apps/gnosi/backend/services/media_service.py`:
    - Mètode nou `_load_user_metadata()` / `_save_user_metadata()` / `update_metadata()`.
    - `get_all_media`: nous params i pas de filtre/sort post-cache.
    - `_get_file_info`: hidrata `tags`/`description` des del sidecar.
  - `monorepo/apps/gnosi/backend/api/vault_routes.py`:
    - `GET /vault/media`: declarar i propagar nous query params.
- **Frontend**:
  - `monorepo/apps/gnosi/frontend/src/pages/MediaCenter.jsx`:
    - Component intern `MediaToolbar`.
    - Estat `filters` + `sort` i serialització a `URLSearchParams`.
    - Reset de paginació en canviar filtres.

## Treball futur (F2-F4)

- F2: índex EXIF persistit (sqlite a `~/.cache/gnosi/exif_index.db`, NO al vault).
- F3: persistència de vistes a `vault/.gnosi/media_views.json` + sidebar "Vistes".
- F4: agrupació timeline + endpoint `/vault/media/facets` per omplir selectors.
