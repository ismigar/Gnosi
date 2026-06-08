# DIRECTIVE: VAULT_TRASH (paperera amb soft-delete i purga programada)

> ID: vault_trash_v1
> Associated Script: backend/api/vault_routes.py (endpoints) + backend/scheduler/manager.py (purge)
> Last Update: 2026-05-12
> Status: ACTIVE

---

## 1. Objectives and Scope

Substituir l'eliminació destructiva de pàgines del Vault (`DELETE /api/vault/pages/{id}`) per un **soft-delete** amb paperera interna. La pàgina es mou a una carpeta `.trash/` dins el data root del Vault, preservant el seu fitxer `.md` original i un sidecar JSON amb les metadades necessàries per restaurar-la al lloc d'origen. Una tasca programada (`purge_trash`) elimina permanentment els elements amb `deleted_at > 90 dies`.

- **Main Objective:** Cap eliminació destructiva immediata des de la UI. L'usuari pot restaurar amb un clic mentre el toast és visible (Undo) o més tard des de la vista de paperera. Purga automàtica als 90 dies.
- **Success Criteria:**
  1. `DELETE /api/vault/pages/{id}` retorna 200 i el fitxer ha desaparegut del Vault visible però existeix a `.trash/{id}/page.md` amb `.trash/{id}/_trash.json`.
  2. `POST /api/vault/pages/{id}/restore` recol·loca el fitxer al `original_path` i la pàgina torna a indexar-se.
  3. `GET /api/vault/trash` retorna llista paginable amb metadades essencials.
  4. `DELETE /api/vault/trash/{id}` purga immediatament (irreversible).
  5. La cerca global no retorna pàgines de la paperera per defecte.
  6. El cron `purge_trash` elimina elements amb antiguitat > 90 dies.

## 2. Input/Output (I/O) Specifications

### Inputs

- **Endpoints HTTP:** Vegeu secció 3.
- **Vault path:** Resolt via `get_active_vault_path()` / `get_p("VAULT")`.
- **Retention:** Constant `TRASH_RETENTION_DAYS = 90`.

### Outputs

- **Filesystem:**
  - `VAULT/.trash/{page_id}/page.md` — el fitxer Markdown original (frontmatter intacte).
  - `VAULT/.trash/{page_id}/_trash.json` — sidecar amb `{ "id", "title", "deleted_at" (ISO 8601 UTC), "original_path" (relatiu al Vault), "original_parent_id", "table_id", "size_bytes" }`.
- **HTTP:** Vegeu secció 3.

## 3. Logical Flow (Algorithm)

### 3.1 Soft-delete: `DELETE /api/vault/pages/{id}`

1. Resoldre `file_path = find_page_path(id)`. Si no existeix → 404.
2. Llegir frontmatter (per a `title`, `table_id`).
3. Calcular `relative_original_path = file_path.relative_to(VAULT)`.
4. Crear directori `VAULT/.trash/{id}/`.
5. Moure el fitxer `.md` a `VAULT/.trash/{id}/page.md` (`shutil.move`).
6. Escriure `VAULT/.trash/{id}/_trash.json` amb les metadades.
7. **Conservar** assets (Covers, Icons, attachments). La purga sí els eliminarà.
8. Cridar `remove_from_link_index(id)` perquè els backlinks no apuntin a un fantasma. Forçar invalidació del cache d'índex de pàgines.
9. Retornar `{ "status": "soft_deleted", "id", "deleted_at" (ISO), "title", "original_path", "retention_days" (int = 90), "restorable_until" (ISO, calculat des de `deleted_at + retention_days`) }`.

### 3.2 Restore: `POST /api/vault/pages/{id}/restore`

1. Comprovar que `VAULT/.trash/{id}/_trash.json` existeix.
2. Llegir el sidecar; obtenir `original_path`.
3. Si ja existeix un fitxer al `original_path` (col·lisió per restauració post-creació de nova pàgina amb mateix id, impossible pràcticament però guardar-se les esquenes): retornar 409 amb suggeriment d'usar `path_override` (fora d'abast V1).
4. Si el directori pare del `original_path` no existeix, **recrear-lo**.
5. Moure `VAULT/.trash/{id}/page.md` → `VAULT/{original_path}`.
6. Eliminar el directori `VAULT/.trash/{id}/`.
7. Forçar reindexació de la pàgina (`_last_vault_sync_time = 0.0` o equivalent).
8. Retornar `{ "status": "restored", "id", "restored_path" (relatiu al Vault), "title" }`. (El client refresca via `GET /api/vault/pages/{id}` si necessita el contingut sencer.)

### 3.3 Llistar paperera: `GET /api/vault/trash`

1. `for entry in (VAULT/.trash).iterdir() if entry.is_dir()`:
2. Llegir `_trash.json`. Saltar entrades sense sidecar (artefactes).
3. Retornar array ordenat per `deleted_at` desc, amb `{ id, title, deleted_at, original_path, table_id, size_bytes, days_remaining }` (`days_remaining = 90 − (now − deleted_at).days`).
4. Suport opcional `?q=` per filtre case-insensitive sobre `title`.

### 3.4 Purga immediata: `DELETE /api/vault/trash/{id}`

1. Validar que `VAULT/.trash/{id}/` existeix.
2. `shutil.rmtree(VAULT/.trash/{id})`.
3. Eliminar assets orfes associats (Covers/Icons/attachments si encara existeixen i sap quins eren via sidecar — opcional V1).
4. Retornar 200 `{ "status": "purged" }`.

### 3.4-bis Buidar tota la paperera: `DELETE /api/vault/trash` (sense `{id}`)

1. Iterar `list(VAULT/.trash/*)` (materialitzar la llista abans: purguem mentre iterem).
2. Per a cada dir, `_purge_trash_entry(name)` dins un `try/except` (tolerant: si una falla, segueix).
3. Tot al servidor en `asyncio.to_thread` → **una sola petició HTTP, una sola connexió de BD**.
4. Retornar `{ "status": "emptied", "purged_count", "failed_count", "failed_ids", "freed_bytes" }`.
5. **Prohibit** fer el buidat com a N `DELETE /trash/{id}` concurrents des del client (vegeu §6, error 2026-06-08).

### 3.5 Cron `purge_trash`

1. Registrat a `SchedulerManager.AVAILABLE_TASKS` amb `default_interval = 1440` min (24h).
2. Dispatcher a `_execute_task`: invoca `_task_purge_trash()`.
3. Iterar `VAULT/.trash/*/_trash.json`. Per a cada entrada amb `(now − deleted_at).days >= 90`, fer `shutil.rmtree(parent_dir)`.
4. Retornar `{ "purged_count": N, "freed_bytes": B }`.

## 4. Tools and Libraries

- **Python:** `pathlib`, `shutil`, `json`, `datetime` (timezone-aware UTC), `asyncio.to_thread` per a operacions de filesystem (consistent amb la resta de `vault_routes.py`).
- **No deps noves.**

## 5. Restrictions and Edge Cases

- **`.trash/` ja exclosa de la indexació** (`SKIP_DIRS` a `vault_routes.py:1966`). No tocar.
- **Concurrency:** dos `DELETE` simultanis sobre el mateix `id` poden col·lidir. Si `VAULT/.trash/{id}/` ja existeix, retornar el sidecar existent (idempotent).
- **OneDrive:** moviments dins del Vault són cross-device si el data root i `.trash/` són al mateix volum (sempre ho són). Usar `shutil.move`, no `Path.rename`.
- **Backlinks:** la pàgina eliminada deixa d'aparèixer al graf. En restaurar, els backlinks es recalculen via reindexació. **Es perden els outlinks no resolts** que tenien text → id de la pàgina eliminada (acceptable, els wikilinks per UUID es resolen automàticament en restaurar).
- **Assets (covers/attachments):** no es mouen a `.trash/`. Si s'elimina permanentment, els assets queden orfes (acceptable V1, possible neteja a `system_maintenance`).
- **Pàgines de dashboard (`.dashboards/*.json`):** mateix patró, però fitxer `.json` en lloc de `.md`. El sidecar registra `extension` per saber-ho en restaurar.
- **Sidecar corromput:** si `_trash.json` és invàlid, l'entrada apareix a `GET /api/vault/trash` com a "Sense títol" amb `deleted_at = None` i ordenada al final. La purga la salta (no se sap quan es va eliminar). Cal neteja manual.
- **Path traversal:** `original_path` del sidecar **mai** s'usa directament; cal validar amb `Path.resolve()` i comprovar que `original_path.resolve().is_relative_to(VAULT)` abans de moure-hi res.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 2026-05-12 | (inicial) | — | Directriu creada |
| 2026-05-12 | `_restore_page_from_trash` llançava `ValueError: not in the subpath` als tests amb tmpfs | `vault_root` no resolt vs `target.resolve()` (macOS /var → /private/var) | Sempre fer `vault_root.resolve()` abans de fer `relative_to`. També a la comprovació anti-traversal. |
| 2026-06-08 | «Buidar paperera no funciona»: amb ~100 entrades, la paperera no es buidava (toast d'èxit fals, elements encara presents). Logs: `QueuePool limit of size 20 overflow 30 reached, connection timed out` → `500` en moltes `DELETE /trash/{id}`. | El frontend disparava **N `DELETE /trash/{id}` concurrents** (un per entrada). Cada petició retenia una connexió del pool de BD (via deps `require_role`/`get_workspace_context`) tota la seva durada → el `QueuePool` (20+30) s'esgotava → timeout 30 s → 500. `Promise.allSettled` al client **amagava** els 500 (mai mira els resultats) i mostrava «Paperera buidada». | **No buidar amb N peticions client → satura el pool → 500 amagats. Usar `DELETE /api/vault/trash`** (§3.4-bis): tot al servidor, 1 connexió, reporta `purged/failed`. El client fa **1** crida i mostra el compte real. |
| 2026-06-08 | «El Purge no obre el modal de confirmació de la app» | El botó «Purgar» (purga individual) usava `window.confirm()` natiu. Chrome el **suprimeix** després de diversos diàlegs (casella «impedir diàlegs addicionals») → retorna `false` sense mostrar res → la purga no s'executa i sembla que «no obre». | Substituït per `<ConfirmModal>` (modal de l'app, patró canònic). Cf. §12 («el modal es manté NOMÉS per a la purga»). **Mai `window.confirm/alert/prompt` per a confirmacions destructives** — usar `ConfirmModal`. |

## 7. Rationalizations (Anti-Atajos)

| Excusa / Racionalització | Refutació i Conseqüència |
| --- | --- |
| *"Podem simplement marcar la pàgina amb `deleted: true` al frontmatter i deixar-la al seu lloc"* | **Falso.** Continuaria apareixent al `os.walk` de la indexació, a la cerca, als joins de relations, etc. Requeriria afegir filtres a >20 punts del backend. Moure-la a `.trash/` que ja està exclosa per defecte és O(1) i no toca cap altre filtre. |
| *"Podem fer servir la paperera del macOS (~/.Trash)"* | **Falso.** El backend és Docker (sense accés a ~/.Trash), no permet cerca, no preserva metadades de l'app, i el buidat als 90 dies no és configurable per app. |
| *"No cal el sidecar `_trash.json`, podem deduir l'original_path del nom del fitxer"* | **Falso.** El fitxer original podia viure en una subcarpeta arbitrària (`Tables/Books/abc.md`); el sidecar és l'única font de veritat per restaurar al lloc correcte. |

## 8. Red Flags

- Modificar el filtre `SKIP_DIRS` de la indexació per fer alguna cosa "intel·ligent" amb `.trash/` → no cal, està bé exclosa.
- Esborrar el directori `.trash/{id}/` sense haver llegit el sidecar abans → es perd informació de telemetria (mida, taula d'origen).
- Implementar restauració amb `Path.rename` en lloc de `shutil.move` → trenca si el Vault i `.trash/` són en mounts diferents (no és el cas amb OneDrive, però defensiu).

## 9. Examples of Use

```bash
# Soft-delete
curl -X DELETE http://localhost:8000/api/vault/pages/abc123

# Llistar paperera
curl http://localhost:8000/api/vault/trash

# Restaurar
curl -X POST http://localhost:8000/api/vault/pages/abc123/restore

# Purga immediata
curl -X DELETE http://localhost:8000/api/vault/trash/abc123
```

## 10. Pre-Execution Checklist

- [ ] Variable `GNOSI_VAULT_PATH` configurada.
- [ ] `find_page_path()` operativa (cache d'índex carregat).
- [ ] `SchedulerManager` iniciat al startup.

## 11. Post-Execution Checklist (Verification Gates)

- [ ] `npm run build` (frontend) sense errors.
- [ ] `pytest backend/tests/test_vault_trash.py` (si s'afegeixen tests).
- [ ] cURL al soft-delete, comprovar que la carpeta `.trash/{id}/` existeix amb sidecar correcte.
- [ ] cURL al restore, comprovar que la pàgina torna al `original_path` i apareix a `GET /api/vault/pages`.
- [ ] cURL a `GET /api/vault/trash`, comprovar ordre i camps.
- [ ] Forçar `_task_purge_trash()` manualment amb una entrada mock amb `deleted_at` antic, comprovar purga.
- [ ] UI: prémer "Eliminar", veure toast amb "Desfer" durant 6s, clicar i comprovar que la pàgina torna.
- [ ] UI: anar a `/vault?view=trash`, veure llistat, restaurar i purgar des d'allà.

## 12. Additional Notes

- **Frontend UI**: substituir el `ConfirmModal` per a `pageToDelete`/`recordsToDelete` per crida directa al soft-delete + toast amb acció "Desfer" (5-6 s). El modal de confirmació es manté NOMÉS per a la purga definitiva des de la paperera.
- **Vista de paperera**: nova ruta lògica `/vault?view=trash` (o entrada al sidebar "Paperera") que reaprofita el component `VaultFeed` o `VaultTable` amb dades de `GET /api/vault/trash` i un toolbar diferent (botons "Restaurar" i "Purgar").
- **Cerca global**: el buscador (`GlobalSearchModal`) treballa sobre `allNotes = pages`, que ja exclou `.trash/`. No cal cap canvi a la cerca per al cas per defecte. **Futur (V2)**: opció "Cerca a la paperera" amb fetch separat de `GET /api/vault/trash?q=...`.
