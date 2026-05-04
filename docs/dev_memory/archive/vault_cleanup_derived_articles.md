# DIRECTIVE: VAULT_CLEANUP_DERIVED_ARTICLES

> ID: VAULT-CLEANUP-20260313
> Associated Script: monorepo/apps/gnosi/pipeline/sandbox/cleanup_derived_articles.py
> Last Update: 2026-03-13
> Status: ACTIVE

---

## 1. Objectives and Scope

El bucle de automatización de n8n generó ~560 páginas derivadas basura en la tabla `articles` de Gnosi Vault. Estas páginas son copias/traducciones con `original_page_id`, `original_ids`, o `translation_ids` en su metadata, que el trigger volvía a detectar como cambios, creando un loop.

- **Main Objective:** Identificar y eliminar las páginas derivadas de la tabla `articles` (y opcionalmente otras tablas).
- **Success Criteria:** La tabla `articles` sólo contiene páginas originales (sin campos de derivación en metadata). El dry-run muestra la lista completa antes de cualquier borrado.

## 2. Input/Output (I/O) Specifications

### Inputs
- **API Base:** `http://localhost:5002` (backend Gnosi local)
- **Tabla objetivo:** `articles` (configurable por parámetro)
- **Indicadores de página derivada:** Cualquiera de estos campos en metadata:
  - `original_page_id` (no vacío)
  - `original_ids` (lista no vacía)
  - `translation_ids` (lista no vacía)

### Outputs
- **Dry-run:** `monorepo/apps/gnosi/pipeline/sandbox/.tmp/derived_articles_dry_run.json`
  - Lista de páginas a eliminar: `{id, filename, title, derived_reason}`
- **Delete log:** `monorepo/apps/gnosi/pipeline/sandbox/.tmp/derived_articles_deleted.json`
  - Registro de páginas eliminadas con timestamp

## 3. Logical Flow (Algorithm)

1. **Fetch:** GET `/api/vault/pages/by-table/{table_id}` para obtener todas las páginas de la tabla.
2. **Filter:** Para cada página, inspeccionar `metadata`:
   - `original_page_id` → truthy → es derivada
   - `original_ids` → lista con elementos → es derivada
   - `translation_ids` → lista con elementos → es derivada
3. **Dry-run report:** Guardar en `.tmp/derived_articles_dry_run.json` con counts y lista detallada.
4. **Delete (sólo si `--execute`):** Para cada página derivada, llamar `DELETE /api/vault/pages/{page_id}`.
5. **Log:** Guardar confirmaciones de borrado en `.tmp/derived_articles_deleted.json`.

## 4. Tools and Libraries

- **Python libraries:** `requests`, `json`, `pathlib`, `argparse`, `datetime`
- **External APIs:** Gnosi backend REST API (`localhost:5002`)

## 5. Restrictions and Edge Cases

- **NUNCA ejecutar `--execute` sin revisar el dry-run primero.**
- El endpoint de borrado usa el `id` interno de la página (campo `id` de la respuesta, no `metadata.id`).
- Si el backend devuelve paginación, iterar con `?offset=X&limit=100` hasta agotar.
- Las páginas con `translation_ids` vacío `[]` NO son derivadas (sólo si la lista tiene elementos).
- Si una página tiene `original_page_id = null` y `original_ids = []` y `translation_ids = []` → es original, NO borrar.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 13/03/26 | — | — | — |

## 7. Examples of Use

```bash
# Dry-run (seguro, no borra nada)
cd monorepo/apps/gnosi/pipeline/sandbox
python cleanup_derived_articles.py --table articles --dry-run

# Ejecución real (sólo tras revisar dry-run)
python cleanup_derived_articles.py --table articles --execute
```
