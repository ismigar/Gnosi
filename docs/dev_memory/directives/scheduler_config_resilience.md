# Directive: Resiliència de la config del Planificador (Scheduler)

## Objectiu

Que el Planificador **mai** quedi buit/inactiu en tornar a la màquina després
de dies o setmanes. Símptoma històric: "Logs, historial i planificador surten
buits; acabo funcionalitats i passades unes setmanes no funcionen".

## Causa arrel (diagnòstic 2026-06-01)

El planificador patia **tres** problemes encadenats, tots derivats de posar
estat operatiu al vault de OneDrive (sistema "fred") en lloc de a `local_data`:

1. **Backend mort** — Docker Desktop no arrencava sol de manera fiable. Sense
   `gnosi_backend`, totes les pàgines que depenen de l'API (Logs, Historial,
   Planificador) surten buides encara que les dades hi siguin. → resolt amb el
   LaunchAgent `com.gnosi.boot` (vegeu `gnosi_boot.sh`).

2. **`scheduler_config.json` online-only + auto-sobreescriptura** — el fitxer
   viu a `${VAULT}/.gnosi/scheduler_config.json`. OneDrive el deixa *dataless*
   (i el backend l'escriu constantment, fet que genera conflictes entre les dues
   Macs: `scheduler_config-MacBook Pro de Ismael.json`). Quan `_load_config` no
   el podia llegir, queia a l'`except` i cridava `_init_default_tasks()` que
   **sobreescrivia el fitxer amb totes les tasques desactivades**. La config bona
   es perdia i OneDrive propagava el buit a l'altra màquina.

3. **`.scheduler.lock` fantasma** — el mutex `flock` vivia a
   `${VAULT}/.gnosi/.scheduler.lock`. Un `flock` sobre OneDrive/virtiofs **no
   s'allibera de manera fiable** quan el procés mor; cada `--reload` d'uvicorn hi
   deixava un lock fantasma. Resultat: a cada arrencada `start()` trobava el lock
   pres → `"Another scheduler already holds... Skipping startup"` → **el loop
   `_run_loop` no arrencava MAI** → cap tasca s'executava automàticament (només
   les disparades a mà via `POST /api/schedulers/{name}/run`).

## Regla (implementada a `backend/scheduler/manager.py`)

1. **Mirror local sempre llegible.** `_save_config()` escriu al vault **i** a
   `LOCAL_DATA/system/scheduler_config.local.json`. El mirror viu al volum
   `gnosi_local_data` (ext4 real) → mai online-only, per-instància.

2. **Ordre de càrrega resilient.** `_load_config()`:
   `vault → (si il·legible) mirror local → (si cap) defaults`. Llegir amb
   reintents (`_try_read_tasks`, backoff curt) perquè OneDrive sovint serveix el
   fitxer al 2n intent.

3. **MAI sobreescriure un fitxer existent però il·legible.** Si el vault EXISTEIX
   però no es pot llegir ara mateix, s'arrenca en **mode degradat** (`_degraded`):
   defaults *en memòria*, **sense persistir**, preservant la config bona al disc.
   `_save_config` no toca el vault mentre `_degraded` és True.

4. **El lock va a `local_data`, no al vault.** `start()` posa
   `.scheduler.lock` a `LOCAL_DATA/system/` → `flock` s'allibera bé i el loop
   arrenca.

## Verificació (QA feta)

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
# El loop arrenca (abans MAI):
docker logs gnosi_backend 2>&1 | grep -c "thread started"        # >= 1
# La config no cau a defaults:
docker logs gnosi_backend 2>&1 | grep "config carregada des de"  # vault o mirror local
# 12 tasques, actives preservades:
curl -sk https://localhost:5173/api/schedulers | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d),'tasques')"
# El lock és local, no al vault:
docker exec gnosi_backend ls /app/data/system/.scheduler.lock     # existeix
docker exec gnosi_backend ls /vault/.gnosi/.scheduler.lock        # NO existeix
```

## Restriccions / Edge cases

- **Sembrar el mirror la 1a vegada:** si actives el codi nou amb el vault
  dataless i el mirror inexistent, s'arrenca en mode degradat (defaults en
  memòria) — NO es perd res, però el planificador no executa res aquella sessió.
  Per evitar-ho, sembra el mirror amb la config bona abans del primer restart:
  `docker cp <backup>.json gnosi_backend:/app/data/system/scheduler_config.local.json`.
  ⚠️ NO sembris el mirror llegint `scheduler_manager._tasks` d'un `docker exec`
  acabat d'importar: aquell procés també pot haver caigut en mode degradat i
  t'escriuria els defaults. Usa el backup del fitxer.
- **Backup de seguretat:** abans de tocar res, materialitza i fes còpia del
  fitxer del vault (`/tmp/gnosi_scheduler_backup/`).
- **Millora futura possible:** moure `SCHEDULER` del tot a `local_data` (com
  `MGMT_DB`). Trade-off: la config deixaria de sincronitzar-se entre Macs (cosa
  probablement desitjable: evita que dues màquines executin les mateixes tasques).

## Causa-Efecte (memoritzar)

> Estat operatiu (config escrita sovint, locks) al vault de OneDrive → online-only
> + conflictes entre Macs + flock fantasma → `_load_config` sobreescriu amb
> defaults i el loop no arrenca mai → planificador buit/inactiu. Solució: mirror
> local + mai-sobreescriure + lock a local_data. Vegeu `environment_integrity.md`.
