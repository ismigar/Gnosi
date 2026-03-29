# DIRECTIVE: NOTION_RECURSOS_PILOT_EMBEDDED_VIEWS

> ID: 2026-03-10
> Associated Script: monorepo/apps/gnosi/pipeline/sandbox/notion_recursos_pilot_embedded_views.py
> Last Update: 2026-03-10
> Status: DRAFT

---

## 1. Objectives and Scope

- Main Objective: Executar un pilot de migracio de contingut de la BD Recursos de Notion, preservant estructura (H1/H2/H3, paragraf, llistes, taules) i detectant vistes incrustades (`child_database`) en format reutilitzable per Vault.
- Success Criteria:
  - Es genera un informe JSON de pilot amb un maxim de N pagines.
  - Es genera un resum Markdown amb metriques de blocs i vistes incrustades.
  - Es generen fitxers Markdown de prova en `.tmp/` sense modificar dades de produccio.

## 2. Input/Output (I/O) Specifications

### Inputs

- Required Arguments:
  - `--limit`: integer, numero maxim de pagines del pilot (per defecte 20).
  - `--db-id`: string, id de la base de dades de Notion (per defecte Recursos).
  - `--output-dir`: path, carpeta de sortida sota `.tmp/`.
- Environment Variables (.env_shared or .env):
  - `NOTION_TOKEN`: token de la API de Notion.
- Source Files:
  - `.env_shared` (workspace root) i opcionalment `monorepo/apps/gnosi/.env`.

### Outputs

- Generated Artifacts:
  - `monorepo/apps/gnosi/pipeline/.tmp/recursos_pilot_embedded_views/pilot_audit.json`
  - `monorepo/apps/gnosi/pipeline/.tmp/recursos_pilot_embedded_views/pilot_summary.md`
  - `monorepo/apps/gnosi/pipeline/.tmp/recursos_pilot_embedded_views/markdown/*.md`
- Console Output:
  - Resum final amb nombre de pagines processades, nombre de blocs totals i nombre de vistes incrustades.

## 3. Logical Flow (Algorithm)

1. Initialization: carregar entorn i validar `NOTION_TOKEN`.
2. Acquisition: consultar la BD de Notion amb paginacio.
3. Selection: seleccionar les primeres N pagines del pilot.
4. Processing:
   - Obtenir blocs recursivament per cada pagina.
   - Convertir blocs principals a Markdown.
   - Convertir `child_database` a tags `<database-view ... />` amb metadades disponibles.
   - Construir metriques per tipus de bloc i cataleg de vistes incrustades.
5. Persistence:
   - Guardar markdown de cada pagina en `.tmp/.../markdown/`.
   - Guardar `pilot_audit.json` i `pilot_summary.md`.
6. Cleanup: finalitzar amb resum i codi de sortida 0.

## 4. Tools and Libraries

- Python libraries: `requests`, `python-dotenv`, `pathlib`, `json`, `argparse`, `collections`.
- External APIs: Notion API v1 (`2022-06-28`).

## 5. Restrictions and Edge Cases

- Limits: respectar paginacio de Notion (`page_size <= 100`) i aplicar una pausa curta entre pagines.
- Formats: IDs de Notion poden venir amb guions; conservar l'ID original als informes.
- Child Database: la API de blocs no sempre exposa tota la configuracio de vista (filtres/sort/layout). En aquest cas s'han de marcar com a `config_incomplete` a l'auditoria.
- Dry-run: no escriure dins OneDrive ni dins el Vault productiu.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 10/03/2026 | SyntaxError en frontmatter title (f-string) | Escapat incorrecte de cometes dins una expressio f-string | Crear variable `safe_title` abans del frontmatter i reutilitzar-la sense escapats interns. |
| 10/03/2026 | `child_database` sense `database_id` ni config de vista | La resposta de blocs de Notion no exposa sempre DB id ni filtre/ordenacio/layout de vista | Marcar `config_incomplete: true` a l'auditoria i diferir mapeig semantic de filtres a una fase posterior. |
| 10/03/2026 | `child_database` amb ID aparentment buit però endpoint de DB respon validacio de datasource | Notion API retorna `validation_error` de data sources no accessibles per la integracio, pero el block ID segueix identificant la base de dades | Aplicar segon pass: provar `/v1/databases/{block_id}` i, si retorna error de datasource inaccessible, inferir `database_id = block_id` amb `resolution_status=resolved_but_datasource_inaccessible`. |

Implementation Note: davant qualsevol error de token, limit o resposta incompleta, documentar-lo i actualitzar aquesta directiva amb regla preventiva explicita.

## 7. Examples of Use

```bash
python monorepo/apps/gnosi/pipeline/sandbox/notion_recursos_pilot_embedded_views.py --limit 20
python monorepo/apps/gnosi/pipeline/sandbox/notion_recursos_pilot_embedded_views.py --limit 50 --output-dir monorepo/apps/gnosi/pipeline/.tmp/recursos_pilot_50
```

## 8. Pre-Execution Checklist

- [ ] `NOTION_TOKEN` disponible a `.env_shared` o `.env`
- [ ] Dependencias instalades (`requests`, `python-dotenv`)
- [ ] Carpeta `.tmp/` accessible

## 9. Post-Execution Checklist

- [ ] `pilot_audit.json` generat i valid
- [ ] `pilot_summary.md` generat
- [ ] Markdown pilot generat per totes les pagines processades
- [ ] Directiva actualitzada amb aprenentatges reals

## 10. Additional Notes

Aquest pilot es centra en observabilitat i fidelitat estructural. La traduccio de filtres Notion "current page" a `{{self}}` es valida en fase posterior amb mapeig semantico del schema de cada vista.
