# Directiva: Abstracció FilesProvider (suport multi-proveïdor d'emmagatzematge)

**Última actualització:** 2026-05-10
**Estat:** ACTIVE (Fase 3)
**Mòdul:** `monorepo/apps/gnosi/backend/services/files_provider/`

## Problema

El backend assumeix que el vault viu sobre OneDrive amb "Files On-Demand"
(fitxers virtuals que es materialitzen quan s'obren). Aquesta hipòtesi
està incrustada al codi en dos llocs:

1. **Detecció d'online-only** via `getattr(st, "st_blocks", 1) == 0` —
   patró específic del File Provider de macOS.
2. **Materialització** via crida HTTP al daemon `onedrive_warmup_daemon.py`
   que corre al host i fa `open()/read()` per disparar la baixada del
   File Provider.

Si l'usuari muntés el vault sobre Google Drive File Stream, iCloud Drive,
NextCloud Virtual Files o un disc local pur, la lògica actual:
- Detectaria fitxers com a "online-only" amb falsos positius/negatius
  (no totes les implementacions deixen `st_blocks==0`).
- Cridaria un daemon que no té sentit (vault local) o que no funciona
  amb un altre proveïdor.

## Objectiu

Introduir una capa fina d'abstracció que aïllï la detecció + materialització
darrere d'una interfície estable.

**Fase 1** cobreix:

- **`LocalProvider`**: vault sobre disc local pur. `is_online_only()`
  sempre `False`, `materialize()` no-op `True`.
- **`OneDriveProvider`**: comportament actual (st_blocks + warmup daemon).
  Encapsula el semàfor, la cache "inflight" i les variables d'entorn
  `ONEDRIVE_WARMUP_URL`, `ONEDRIVE_WARMUP_TIMEOUT`, `VAULT_HOST_PATH`.

**Fase 2** afegeix:

- **`iCloudDriveProvider`** (subclass de `OneDriveProvider`): mateix
  patró File Provider de macOS (`st_blocks==0`, materialització via
  `open()`). Reutilitza el daemon `sh/onedrive_warmup_daemon.py`
  (que és agnòstic al proveïdor — només fa `open()/read()` sobre un
  path absolut). Prioritza env vars `ICLOUD_WARMUP_URL` /
  `ICLOUD_WARMUP_TIMEOUT`; cau a les `ONEDRIVE_*` si no estan
  definides. `name = "icloud"` (visible al log).

**Fase 3** afegeix:

- **`GoogleDriveProvider`** (subclass de `OneDriveProvider`): Drive
  for Desktop a macOS modern (≥ 2023) usa el File Provider framework
  exactament igual que OneDrive. Cap canvi de detecció ni
  materialització; només `name = "gdrive"` i env vars `GDRIVE_*` amb
  fallback a `ONEDRIVE_*`. El Drive File Stream antic (FUSE
  `/Volumes/GoogleDrive/`, pre-2023) NO està suportat — Google va
  migrar tots els usuaris al sistema modern.
- **`NextCloudProvider`** (subclass de `OneDriveProvider`):
  **EXPERIMENTAL**. NextCloud client no usa el File Provider de
  macOS; en lloc d'això marca placeholder amb un xattr
  `user.nextcloud.is-virtual-file` (Linux/macOS) o crea fitxers amb
  extensió `.nc-virt` (configurable via `NEXTCLOUD_PLACEHOLDER_EXT`).
  La detecció `is_online_only` usa aquests senyals; la materialització
  delega al daemon HTTP igual que OneDrive (la majoria de versions
  de NextCloud client responen a `open()/read()` amb la baixada). Si
  la teva versió no respon, cal un daemon dedicat amb una comanda
  CLI (`nextcloudcmd --download`) — configurable via
  `NEXTCLOUD_WARMUP_URL`. Estat: esquelet sense validació a
  instal·lació real.

Fases futures (no incloses): `WindowsFilesOnDemandProvider` (Cloud
Filter API + xattr `OFFLINE`), `WebDAVProvider` (mounts WebDAV
genèrics fora del client NextCloud).

## Interfície

```python
# backend/services/files_provider/base.py
class FilesProvider(Protocol):
    name: str  # "local" | "onedrive" | ...

    def is_online_only(self, container_path: Path) -> bool:
        """True si el fitxer existeix lògicament però no està descarregat."""

    async def materialize(self, container_path: Path) -> bool:
        """Demana al proveïdor que descarregui el fitxer. True si està
        disponible localment després de la crida."""
```

## Selecció del proveïdor

`get_files_provider()` (singleton) decideix segons:

1. Env var explícita `GNOSI_FILES_PROVIDER`
   (`local` | `onedrive` | `icloud` | `gdrive` | `nextcloud`).
2. Si no està definida i `VAULT_HOST_PATH` existeix, en aquest ordre:
   - conté `OneDrive`                          → `onedrive`
   - conté `GoogleDrive` o `Google Drive`      → `gdrive`
   - conté `Mobile Documents` o `iCloud`
     (case-insensitive)                        → `icloud`
   - conté `nextcloud` (case-insensitive)      → `nextcloud`
3. Altrament → `local`.

L'ordre és deliberat: `OneDrive` és el match més comú a Gnosi i va
primer; els altres serveixen com a fallback per a setups menys habituals.
Si un path té múltiples keywords (p. ex. carpeta de backup amb noms
barrejats), guanya el primer match.

L'usuari pot forçar el comportament via env var. La detecció heurística
existeix només per no trencar instal·lacions actuals.

## Política

1. **Cap codi de producte ha de cridar `_warmup_onedrive_file()` o
   comprovar `st_blocks` directament.** Tot va via `get_files_provider()`.
2. El daemon `sh/onedrive_warmup_daemon.py` continua sent OneDrive-específic
   i només l'arrenca l'usuari quan fa servir aquell proveïdor.
3. Les env vars existents (`VAULT_HOST_PATH`, `ONEDRIVE_WARMUP_URL`,
   `ONEDRIVE_WARMUP_TIMEOUT`) **no canvien noms** — són OneDrive-only.
   Les futures fases afegiran `GDRIVE_*`, `ICLOUD_*` paral·leles.
4. **Errno 35 (Resource deadlock avoided) NO és OneDrive-específic** —
   és un comportament del bind-mount grpcfuse de Docker Desktop sota
   pressió, i es manifesta amb qualsevol filesystem cloud-syncat. Els
   retries amb backoff escampats per `vault_routes.py` queden com estan
   en aquesta fase; no formen part de l'abstracció `FilesProvider`.

## Llocs a refactoritzar (Fase 1)

A `monorepo/apps/gnosi/backend/api/vault_routes.py`:

- L. 3705-3777: `_warmup_onedrive_file()` i variables de mòdul
  (`_WARMUP_URL`, `_WARMUP_TIMEOUT_S`, `_WARMUP_SEMAPHORE`, `_WARMUP_INFLIGHT`)
  → mou-ho a `OneDriveProvider`.
- L. 3837-3848 (a `serve_vault_image`): substitueix `getattr(st, "st_blocks", 1) == 0`
  + crida a `_warmup_onedrive_file` per
  `provider.is_online_only(requested)` + `await provider.materialize(requested)`.
- L. 3937-3946 (a `_serve_file_with_containment`): mateix patró.

## Compatibilitat retroactiva

- Si `VAULT_HOST_PATH` apunta a un path amb "OneDrive" al nom (instal·lació
  actual de l'usuari), `get_files_provider()` retorna `OneDriveProvider`
  sense canviar comportament.
- Si l'usuari posa `GNOSI_FILES_PROVIDER=local`, el backend salta tot el
  warmup; suposa que totes les lectures funcionen directament.

## Restriccions / Edge cases

- **No fer servir `Protocol` a runtime**: Python no comprova `Protocol`
  estructuralment a runtime sense `runtime_checkable`. Usem `ABC` amb
  `abstractmethod` per fallar fort si una subclasse oblida un mètode.
- **Singleton thread-safe**: `get_files_provider()` ha de ser idempotent
  i thread-safe (FastAPI pot servir requests en paral·lel).
- **Logging**: el log "☁️→💾 Materialitzat OneDrive ..." conserva la mateixa
  forma per no trencar grep/parsing existent.
- **Reiniciar el container** després del refactor: el codi viu en bind-mount
  però el procés Python ja té el mòdul vell carregat. `docker compose restart gnosi_backend`.

## QA Gates (Fase 1)

1. **Build estàtic**: `docker compose build backend` sense errors.
2. **Healthcheck**: `docker compose up -d backend && curl http://localhost:5002/api/health`.
3. **Test funcional**: obrir una imatge del vault que estigui online-only
   (verificar al log "Materialitzat OneDrive ..."). Després obrir-ne una
   ja materialitzada (no ha d'aparèixer al log).
4. **Test no-regressió**: el frontend ha de mostrar les imatges de la
   biblioteca i del vault sense errors 503.

## Casos observats

### 2026-05-09 — Daemon de warmup ignorava el seu propi TIMEOUT_S

Durant el QA E2E de la Fase 1 (instal·lació actual: `OneDriveProvider`),
peticions a imatges online-only retornaven 503 sistemàticament després
de 100s (el timeout HTTP del backend). La crida directa al daemon
`http://localhost:5009/warmup?path=...` també penjava >120s sense
resposta, amb el daemon "running" i Full Disk Access actiu.

**Causa arrel:** la versió original de `_materialize()` comprovava
`time.time() - t0 > TIMEOUT_S` *entre* `f.read(1MB)`. Quan OneDrive
no fa progrés (xarxa lenta, sync pausat, fitxer remot inaccessible),
`read()` queda bloquejat al kernel i la comprovació mai s'executa.

**Fix:** executem el `read()` en un thread daemon i fem `join(TIMEOUT_S)`.
Si el thread no acaba a temps, retornem `timeout`; el thread queda
corrent en background fins que el `read()` retorni o el procés mori.
Així la propera petició pel mateix fitxer ja el trobarà materialitzat
si OneDrive ha acabat per sota.

**Lliçó:** entre I/O bloquejant i deadlines, una flag cooperativa
*entre* iteracions no n'hi ha prou — cal un mecanisme que pugui
interrompre la crida en si (thread+join, signal.alarm, o non-blocking
fd + select).

**Verificació:** `sh/start_warmup_daemon.sh --bg` (després de matar el
daemon vell amb `kill $(cat /tmp/onedrive_warmup_daemon.pid)`), després
demanar una imatge online-only — el log ha de mostrar
`warmup timeout per ... després de Ts` dins el TIMEOUT_S configurat,
no més.

### 2026-05-09 — Fase 2: `iCloudDriveProvider` afegit

S'afegeix el segon proveïdor cloud-on-demand. iCloud Drive a macOS
utilitza el mateix File Provider framework que OneDrive: detecció
via `st_blocks==0`, materialització via `open()`. El daemon HTTP del
host és agnòstic al proveïdor i serveix per ambdós casos sense canvis.

**Reutilització de codi:** `iCloudDriveProvider(OneDriveProvider)`
sobreescriu només `name="icloud"` i prioritza env vars `ICLOUD_*`
abans de caure a les `ONEDRIVE_*`. No duplica lògica.

**Tests d'unitat (9 assertions, totes passen):**
- Detecció heurística per `Mobile Documents` i `iCloud` als paths.
- Detecció no regressa per OneDrive (`OneDrive` al path).
- Override explícit via `GNOSI_FILES_PROVIDER=icloud`.
- Prioritat `ICLOUD_WARMUP_URL` > `ONEDRIVE_WARMUP_URL` > default.
- `ICLOUD_WARMUP_TIMEOUT` respectat.
- Valor desconegut a `GNOSI_FILES_PROVIDER` → log warning + heurística.

**Per provar amb un usuari real d'iCloud:**

1. Munta el vault dins de `~/Library/Mobile Documents/com~apple~CloudDocs/Gnosi/`.
2. Configura `VAULT_HOST_PATH` al `docker-compose.yml` amb aquest path.
3. Arrenca el daemon de warmup amb FDA al Terminal: `sh/start_warmup_daemon.sh --bg`.
4. Comprova el log del backend: `FilesProvider actiu: icloud`.

Si en algun moment cal un daemon dedicat a iCloud (per separar mètriques,
limitats per Apple, etc.), defineix `ICLOUD_WARMUP_URL=http://...:6000/warmup`
i arrenca un segon daemon en aquell port.

### 2026-05-10 — Fase 3: GoogleDrive + NextCloud

S'afegeixen dos proveïdors més per cobrir els casos d'usuaris no-OneDrive.

**`GoogleDriveProvider` (gdrive):** trivial — Drive for Desktop modern
a macOS comparteix el File Provider framework, així que la subclass
és gairebé idèntica a `iCloudDriveProvider`. Heurística: keyword
`GoogleDrive` o `Google Drive` al `VAULT_HOST_PATH`. Env vars
`GDRIVE_WARMUP_URL` / `GDRIVE_WARMUP_TIMEOUT` amb fallback a `ONEDRIVE_*`.

**`NextCloudProvider` (nextcloud):** primer cas amb mecanisme
*genuïnament diferent*. NextCloud client no usa File Provider de
macOS — marca placeholders amb:

- xattr `user.nextcloud.is-virtual-file` (Linux/macOS); o
- extensió `.nc-virt` (configurable via `NEXTCLOUD_PLACEHOLDER_EXT`).

Detecció via `os.listxattr` (no disponible a Windows → False) i
comparació d'extensió. Si el bind-mount Docker no propaga xattrs
(depèn del filesystem host), cau a la detecció per extensió.

La materialització delega al daemon HTTP existent. Funciona si la
versió del client NextCloud respon a `open()/read()` amb la baixada;
cal validar amb la teva instal·lació concreta. Si no respon, configura
`NEXTCLOUD_WARMUP_URL=http://host.docker.internal:5010/warmup` i
arrenca un daemon dedicat que executi `nextcloudcmd` (no inclòs).

**Tests d'unitat (41 totals):**
- 19 nous (heurística per gdrive/nextcloud, env vars, override
  explícit, precedència OneDrive sobre keywords múltiples, detecció
  per extensió i xattr, no-regressió fitxers normals).
- Test parametritzat de contracte ampliat als 5 providers.

**Lliçó:** L'abstracció funciona. Afegir un proveïdor amb mecanisme
de detecció diferent (xattr vs st_blocks) requereix sobreescriure
només `is_online_only` — la materialització, la concurrency i el
host-path mapping queden intactes a la base.
