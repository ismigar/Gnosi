# DIRECTIVE: NOTION_TO_GNOSI_IMPORT

> ID: 2026-02-22
> Associated Script: monorepo/apps/gnosi/pipeline/skills/notion_migration/scripts/notion_to_gnosi_full_import.py
> Last Update: 2026-03-16
> Status: ACTIVE

---

## 1. Objectives and Scope

- **Main Objective:** Synchronize Notion databases with a local vault, resolve relational IDs to human-readable titles, and allow creating new notes from relations.
- **Success Criteria:** 
    - Markdown files generated with `id` in frontmatter.
    - Global index endpoint `/api/vault/global-index` available.
    - Frontend reflects titles instead of UUIDs.
    - Quick creation functionality (`POST /api/vault/notes/create`) integrated into the UI.

## 2. Input/Output (I/O) Specifications

### Inputs

- **Environment Variables (.env_shared):**
    - `NOTION_TOKEN`: Integration token for Notion API.
    - `gnosi_VAULT_PATH`: Local path to the OneDrive folder.
- **Notion Databases:** Hardcoded mapping in the script between database names and Notion IDs.

### Outputs

- **Generated Artifacts:**
    - `[Vault_Path]/[Database_Name]/*.md`: Files with YAML frontmatter + BlockNote JSON body.
    - `[Vault_Path]/Assets/*`: Downloaded images and files from Notion blocks.
    - `vault_db_registry.json`: Updated with new views discovered from `child_database` blocks.
- **Console Output:** Progressive status of the migration ("Abocant: ...").

## 3. Logical Flow (Algorithm)

1. **Initialization:** Load environment variables, validate `NOTION_TOKEN`, build reverse maps from `vault_db_registry.json`.
2. **Setup:** Create target folders for each database if they don't exist.
3. **Database Iteration:** For each configured database:
    - Fetch all pages via Notion API.
    - For each page:
        - Extract properties (Select, Multi-select, Formula, etc.).
        - Fetch block content (paragraphs, lists, images).
        - **Metadata Enrichment:** Add the Notion Page ID as `id` in the frontmatter.
        - **Block Conversion:** Convert all blocks to BlockNote JSON (columns, embedded views, colors).
        - **Asset Management:** Download and rename assets, updating links in content.
        - **Persistence:** Save YAML frontmatter + BlockNote JSON body to file.
4. **Registry Update:** Save any new embedded views discovered during migration to `vault_db_registry.json`.

## 4. Tools and Libraries

- **Python libraries:** `requests`, `yaml` (PyYAML), `python-dotenv`, `pathlib`, `re`.
- **External APIs:** Notion API (v1).

## 5. Restrictions and Edge Cases

- **Rate Limits:** The script implements a sleep of 0.35s between pages to respect Notion's API limits.
- **Naming:** Filenames are sanitized to avoid invalid characters in various OS.
- **Argument BD:** El script accepta un argument opcional per migrar una sola BD: `python3 script.py Projectes`
- **Recursivitat:** Quan un bloc té `has_children: true`, el script fa una crida adicional a l'API per obtenir els fills. Afecta: llistes, toggles, columnes, callouts, pargrafs.
- **Blocs suportats:** paragraph, heading_1/2/3, bulleted/numbered_list_item (amb subnivells), to_do, quote, code, divider, callout, image, file, pdf, video, audio, **table + table_row** (taules natives), toggle, **column_list/column** (multicolumna), **child_database** (vista incrustada), child_page, link_to_page, embed, bookmark, link_preview, synced_block, equation.
- **Format de sortida:** Markdown Enriquit (Gnosi Directives). El contingut del body és text Markdown pur amb extensions `:::column-list`, `:::column` i `:::toggle` compatibles amb el parser `markdown-mapper.js`.
- **Columnes:** `column_list` → `:::column-list` amb fills `:::column`.
- **Toggles:** `toggle` → `:::toggle [Resum]`.
- **BBDD Incrustades:** `child_database` → Bloc de codi ` ```gnosi-database ... ``` `.
- **Colors:** Nota: El format Markdown actual prioritza la llegibilitat; els colors de bloc de Notion s'ignoren en favor d'un estil net, mantenint però les negretes/itàliques.
- **synced_block:** Si té `synced_from`, intenta obtenir i processar el contingut de la font (pot fallar si no hi ha accés).
- **Note:** Do NOT use `convert_block_to_md` (versió antiga, eliminada). Usar sempre `convert_blocks_to_md(blocks_list)`.
- **IMPORTANT:** Executar l'script amb `DIGITAL_BRAIN_VAULT_PATH` apuntant al vault correcte (OneDrive). Ex: `DIGITAL_BRAIN_VAULT_PATH="/Users/ismaelgarciafernandez/Library/CloudStorage/OneDrive-UNED/Gnosi" python3 notion_to_gnosi_full_import.py`
- **IMPORTANT:** El `vault_db_registry.json` DEVE tenir el camp `folder` per cada taula, coincidint amb el nom real de la carpeta al filesystem. Ex: `"folder": "Arees"` no `"folder": "Àrees"` (si la carpeta no té accent).
- **### Resolució de Relacions i Índex Global
Per resoldre IDs de relació (UUIDs de Notion) a títols llegibles, el backend genera un índex global (`/api/vault/global-index`) escanejant recursivament tot el Vault.

El component `BlockEditor` utilitza aquest índex per:
1. **Renderitzar títols**: Transforma els IDs del frontmatter en enllaços o etiquetes visuals amb el títol de la nota.
2. **Autocompletat Global**: El selector de relacions permet cercar i enllaçar notes de qualsevol carpeta del Vault (no només la carpeta actual), utilitzant totes les claus disponibles a l'índex global com a opcions.

### Creació Ràpida de Notes
En els camps de relació, si una nota no existeix, es permet crear-la al moment. El sistema utilitza el nom del camp per determinar la carpeta de destí automàticament (ex: `📀 Recursos` -> `Recursos`).

- **Nota**: El sistema genera un `id` local (UUID) per mantenir la integritat de les relacions fins i tot per a notes creades fora de Notion.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 22/02/26 | Relation IDs unreadable | Migration script didn't export `notion_id` | Added `frontmatter['notion_id'] = page_id` in `migrate_database`. |
| 22/02/26 | MD parsing errors | Invalid YAML in formula fields | Added explicit `String` casting for all metadata values before dumping. |
| 22/02/26 | Relations not clickable | No mechanism to create notes from IDs | Added `POST /notes/create` and frontend UI for "+ Crear" on non-existent relations. |
| 27/02/27 | Tables and embedded views not migrated | `convert_block_to_md` had no recursion and no `table`/`table_row` support | Rewrote to `convert_blocks_to_md(list)` with full recursion + table/toggle/embed/synced_block support. |
| 28/03/26 | Records not visible in frontend | Registry missing `folder` field for tables | Added `folder` field mapping to actual filesystem folder names. **IMPORTANT:** The `vault_db_registry.json` MUST have the `folder` field set for each table, matching the actual folder name in the vault. |
| 03/04/26 | Many Notion fields migrated as empty | Property type `rich_text` was not exported in frontmatter and `button` was silently ignored | Added extraction for `rich_text` and explicit marker for `button` to avoid silent data loss. |
| 03/04/26 | Embedded database blocks lost when unresolved | `child_database` fallback degraded to plain quote text and IDs are not always retrievable as databases | Added robust resolver with search cache + unresolved `gnosi-database` placeholder block preserving Notion source IDs/titles. |

## 7. Examples of Use

```bash
# Migrate all databases
python3 pipeline/skills/notion_migration/scripts/notion_to_gnosi_full_import.py

# Migrate a single database
python3 pipeline/skills/notion_migration/scripts/notion_to_gnosi_full_import.py Projectes
```

## 8. Pre-Execution Checklist

- [x] Environment variables configured in `.env_shared`
- [x] Dependencies installed (`pip install requests pyyaml python-dotenv`)
- [x] Notiony Integration has access to all databases

## 9. Post-Execution Checklist

- [ ] All `.md` files contain `id` in frontmatter.
- [ ] Frontend dashboard correctly resolves relations.
- [ ] Requirements.txt updated in the pipeline folder.

## 10. Additional Notes

The script assumes a flat property extraction. Formulas or complex rollups are converted to their last known string/number value.
