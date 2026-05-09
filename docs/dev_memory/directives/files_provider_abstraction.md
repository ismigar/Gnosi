# Directiva: Abstracció FilesProvider (suport multi-proveïdor d'emmagatzematge)

**Última actualització:** 2026-05-09
**Estat:** ACTIVE (Fase 1)
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
darrere d'una interfície estable. La fase 1 cobreix dos proveïdors:

- **`LocalProvider`**: vault sobre disc local pur. `is_online_only()`
  sempre `False`, `materialize()` no-op `True`.
- **`OneDriveProvider`**: comportament actual (st_blocks + warmup daemon).
  Encapsula el semàfor, la cache "inflight" i les variables d'entorn
  `ONEDRIVE_WARMUP_URL`, `ONEDRIVE_WARMUP_TIMEOUT`, `VAULT_HOST_PATH`.

Fases 2+ (no incloses ara): `GoogleDriveFileStreamProvider`,
`iCloudDriveProvider`, `NextCloudProvider`.

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

1. Env var explícita `GNOSI_FILES_PROVIDER` (`local` | `onedrive`).
2. Si no està definida i `VAULT_HOST_PATH` existeix i conté `OneDrive`
   o `OneDrive-` al path → `onedrive`.
3. Altrament → `local`.

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

*(buit; emplenar a mesura que apareguin regressions o aprenentatges)*
