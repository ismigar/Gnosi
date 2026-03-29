# DIRECTIVE: NOTION_RECURSOS_UNMAPPED_APPLY_CONSERVATIVE

> ID: 2026-03-10
> Associated Script: monorepo/apps/gnosi/pipeline/sandbox/notion_recursos_unmapped_apply_conservative.py
> Last Update: 2026-03-10
> Status: DRAFT

---

## 1. Objectives and Scope
- Main Objective: Aplicar conciliacio conservadora dels `unmapped_relation_ids` sobre Notes locals, amb llindar alt de confiança.
- Success Criteria:
  - Dry-run report JSON sense modificar fitxers.
  - Apply amb backups obligatoris.
  - Nomes mappings `exact_unique` / `normalized_unique` i `fuzzy_candidates` amb score >= llindar.

## 2. Input/Output (I/O) Specifications
### Inputs
- Required Arguments:
  - `--backfill-report`
  - `--candidates-json`
- Optional Arguments:
  - `--fuzzy-threshold` (default `0.90`)
  - `--apply`
  - `--report-path`

### Outputs
- Report JSON amb `counts`, `mapping_summary`, `sample_changes`, `updated_files`.
- Backups a `.tmp/recursos_unmapped_apply_<timestamp>/backups/` en apply.
- Sortida de consola `UNMAPPED_APPLY_DONE`.

## 3. Logical Flow
1. Carregar backfill + candidats.
2. Construir map conservador.
3. Recorrer notes afectades.
4. Actualitzar `resource_ids` al frontmatter.
5. Dry-run / apply amb backup.

## 4. Restrictions and Edge Cases
- IDs com strings opacs (no UUID validation).
- Si falta frontmatter: skip.
- Si no hi ha mapping: skip.
- Si ja existeix mapping: skip.
- Ordre determinista.

## 5. Error Protocol and Learning
| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 10/03/2026 | Quedaven `unmapped_relation_ids` despres del backfill principal | El backfill no aplica candidats fuzzy separadament | Crear fase conservadora amb llindar `0.90` i backups. |
| 10/03/2026 | Risc de trencar mappings per format d'ID | Barretja UUID + `id_manual` textual | Tractar IDs com opacs. |

| 10/03/2026 | Execucio fallava amb ModuleNotFoundError: yaml | Es feia servir una venv diferent (digital-brain) sense PyYAML | Executar scripts de Gnosi amb `/Users/ismaelgarciafernandez/Projectes/monorepo/apps/gnosi/.venv/bin/python`; dry-run/apply completats (7 notes, 7 relacions). |
