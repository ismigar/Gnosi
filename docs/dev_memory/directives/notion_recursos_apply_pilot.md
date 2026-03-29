# DIRECTIVE: NOTION_RECURSOS_APPLY_PILOT

> ID: 2026-03-10
> Associated Script: monorepo/apps/gnosi/pipeline/sandbox/notion_recursos_apply_pilot.py
> Last Update: 2026-03-10
> Status: DRAFT

---

## 1. Objectives and Scope

- Main Objective: Aplicar contingut migrat des del pilot de Notion Recursos als fitxers markdown locals de Recursos, mantenint frontmatter existent i substituint nomes el body.
- Success Criteria:
  - Es genera un report JSON amb matchs, misses i errors.
  - En mode dry-run no es modifica cap fitxer real.
  - En mode apply, cada fitxer actualitzat te backup previ.

## 2. Input/Output (I/O) Specifications

### Inputs

- Required Arguments:
  - `--pilot-dir`: carpeta amb `pilot_audit.json` i `markdown/*.md`.
  - `--target-dir`: carpeta local de Recursos.
- Optional Arguments:
  - `--apply`: boolea; si no es passa, per defecte es dry-run.
  - `--report-path`: path del report de sortida.
- Source Files:
  - Fitxers markdown de pilot amb frontmatter `notion_id`.
  - Fitxers markdown locals amb frontmatter `id` (sense guions).

### Outputs

- Generated Artifacts:
  - Report JSON amb: total pilot, matched, updated, missing_target, skipped.
  - En dry-run: carpeta `.tmp/.../candidate_updates/` amb propostes de contingut.
  - En apply: backups en `.tmp/.../backups/`.
- Console Output:
  - Resum final amb comptadors principals.

## 3. Logical Flow (Algorithm)

1. Initialization: validar camins i carregar fitxers pilot.
2. Index target: llegir tots els `.md` de target i indexar per `id` normalitzat.
3. Match:
   - extreure `notion_id` de cada fitxer pilot.
   - normalitzar i buscar al target.
4. Transform:
   - mantenir frontmatter actual del target.
   - substituir cos del target pel cos pilot.
5. Persist:
   - dry-run: escriure candidats i report.
   - apply: fer backup i sobreescriure target.
6. Cleanup: resum i codi 0.

## 4. Tools and Libraries

- Python libraries: `argparse`, `json`, `re`, `pathlib`, `shutil`, `datetime`.

## 5. Restrictions and Edge Cases

- No-overwrite sense backup: en mode apply sempre generar backup abans de modificar.
- Frontmatter mandatory: si falta frontmatter al target, marcar com skipped.
- ID normalization: comparar IDs sense guions i en lowercase.
- Determinism: no dependre d'ordre no determinista de fitxers.
- Embedded views migrated from Notion often arrive as `<database-view ... viewType="table" />` with `title="Untitled"`; normalize to `type="table"` and assign `folder="notes"` to avoid manual table selection in the Vault UI.
- Self filter policy: en embeds `Untitled` de Recursos, injectar `filters` amb condicio `resource_ids contains {{self}}` per restringir els resultats a la nota recurs actual.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 10/03/2026 | No missing target files in dry-run/apply | IDs pilot (`notion_id`) i target (`id`) coincideixen al 100% després de normalitzar | Procedir amb `--apply` amb backup obligatori i conservar frontmatter target. |
| 10/03/2026 | Embeds desconnectats mostraven selector de taula manual | Tags migrats amb `viewType` legacy i sense mapping explícit de `folder` | Normalitzar a `type="table"`, assignar `folder="notes"` i injectar filtre `resource_ids contains {{self}}`; validat visualment en mostra de 10 notes recents. |

## 7. Examples of Use

```bash
python monorepo/apps/gnosi/pipeline/sandbox/notion_recursos_apply_pilot.py \
  --pilot-dir monorepo/apps/gnosi/pipeline/.tmp/recursos_pilot_embedded_views \
  --target-dir "/Users/ismaelgarciafernandez/OneDrive/Gnosi/BD/Cervell Digital/Recursos"

python monorepo/apps/gnosi/pipeline/sandbox/notion_recursos_apply_pilot.py \
  --pilot-dir monorepo/apps/gnosi/pipeline/.tmp/recursos_pilot_embedded_views_100 \
  --target-dir "/Users/ismaelgarciafernandez/OneDrive/Gnosi/BD/Cervell Digital/Recursos" \
  --apply
```
