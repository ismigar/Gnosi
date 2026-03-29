# DIRECTIVE: NOTION_DB_SCHEMA_TO_GNOSI_TABLE

> ID: 2026-03-13
> Associated Script: monorepo/apps/gnosi/pipeline/sandbox/notion_db_schema_to_gnosi_table.py
> Last Update: 2026-03-27
> Status: ACTIVE

---

## 1. Objectives and Scope

- Main Objective: Donat un Notion database id, crear o actualitzar l'esquema de taula corresponent al registre del Vault de Gnosi sense importar cap fila.
- Success Criteria:
  - S'obte la definicio de propietats de la BD de Notion.
  - Es genera una entrada `table` valida a `vault_db_registry.json` amb `properties`.
  - No es creen ni modifiquen notes de dades.

## 2. Input/Output (I/O) Specifications

### Inputs

- Required Arguments:
  - `--notion-db-id`: string, id de la base de dades de Notion.
- Optional Arguments:
  - `--gnosi-db-id`: string, id de la base de dades de Gnosi on afegir la taula (default `digital_brain_db`).
  - `--table-name`: string, nom de la taula a Gnosi (si no, s'usa el titol de Notion).
  - `--table-id`: string, id de taula a Gnosi (si no, s'usa el notion db id).
  - `--registry-path`: path, ruta del `vault_db_registry.json`.
  - `--views-from-snapshot`: path a un JSON de `export_notion_page_snapshot.py` per reproduir vistes associades a la BD.
  - `--import-views`: importa vistes en viu de la Notion Views API (`GET /v1/views` + `GET /v1/views/{id}`).
  - `--create-default-template`: crea una plantilla base de Gnosi vinculada a la taula.
  - `--template-title`: titol de la plantilla base (default `Plantilla base`).
  - `--template-content`: contingut markdown inicial de la plantilla base.
  - `--backend-api-base`: URL base de l'API Vault per crear plantilla (default `http://localhost:5002/api/vault`).
  - `--dry-run`: boolea, mostra el resultat sense escriure fitxers.
- Environment Variables:
  - `NOTION_TOKEN`: token de la integracio Notion.
- Source Files:
  - `vault/vault_db_registry.json` (o el path passat per argument).

### Outputs

- Generated Artifacts:
  - Update de `vault_db_registry.json` (upsert de `tables`; creacio de `databases` si cal).
  - Si es passa `--views-from-snapshot`, upsert de `views` a `registry.views`.
  - Backup en `.bak.<timestamp>` al costat del registry abans d'escriure.
- Console Output:
  - Resum JSON amb `table_id`, `table_name`, nombre de propietats i mode (`dry_run` o `applied`).

## 3. Logical Flow (Algorithm)

1. Initialization: validar arguments, carregar token i localitzar registry.
2. Acquisition: cridar `GET /v1/databases/{id}` de Notion.
3. Processing: convertir tipus de propietats Notion a tipus compatibles amb Gnosi i construir `properties`.
4. Optional Views: si hi ha `--import-views`, llista vistes via `GET /v1/views?database_id=X`, recupera cada vista via `GET /v1/views/{id}` i converteix tipus/filtres/sorts/proprietats visibles a format Gnosi. Si hi ha `--views-from-snapshot`, extreure `database_view` de blocs `child_database`.
5. Optional Template: si hi ha `--create-default-template`, crear una plantilla base a Gnosi via API (`metadata.is_template=true`) evitant duplicats per titol.
6. Fallback: si la API de Notion falla i hi ha snapshot, intentar obtenir el schema des de `embedded_databases`.
7. Persistence:
   - assegurar estructura base `databases/tables/views`.
   - fer upsert de la database de Gnosi si no existeix.
   - fer upsert de la taula per `table_id`.
  - fer upsert de vistes (si se n'han extret).
   - escriure backup + registry (excepte dry-run).
8. Cleanup: imprimir resum final.

## 4. Tools and Libraries

- Python libraries: `argparse`, `json`, `os`, `re`, `datetime`, `pathlib`, `urllib.request`.
- External APIs: Notion API v1 (`2022-06-28`).

## 5. Restrictions and Edge Cases

- Token mandatory: sense `NOTION_TOKEN` el script falla explicitament.
- Read-only types: propietats de sistema de Notion (`created_by`, `last_edited_by`, etc.) es mapegen a tipus simples (`text`/`date`) per mantenir compatibilitat de schema.
- Notion API limitation: Notion no exposa per API publica el cataleg complet de "saved views" ni les plantilles guardades d'una database; la reproduccio fidel de vistes/plantilles depen de fonts addicionals.
- Determinism: la sortida de `properties` es manté en ordre alfabetic de nom.
- Idempotency: reexecutar amb els mateixos arguments no duplica la taula (upsert per `table_id`).
- Idempotency views: les vistes fan upsert per `id` determinista.
- Safety: en mode write sempre crea backup del registry abans d'actualitzar.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 13/03/2026 | N/A (initial draft) | N/A | Primera versio del protocol i script. |
| 27/03/2026 | Script no existia | No s'havia implementat | Creat `notion_db_schema_to_gnosi_table.py` amb suport per --dry-run, --views-from-snapshot, backup atomic.

## 7. Examples of Use

```bash
python monorepo/apps/gnosi/pipeline/sandbox/notion_db_schema_to_gnosi_table.py \
  --notion-db-id 11c268e5-2714-81c1-9d48-d2fd9752c407 \
  --dry-run

python monorepo/apps/gnosi/pipeline/sandbox/notion_db_schema_to_gnosi_table.py \
  --notion-db-id 11c268e5-2714-81c1-9d48-d2fd9752c407 \
  --gnosi-db-id digital_brain_db

python monorepo/apps/gnosi/pipeline/sandbox/notion_db_schema_to_gnosi_table.py \
  --notion-db-id 11c268e5-2714-81c1-9d48-d2fd9752c407 \
  --import-views \
  --dry-run

python monorepo/apps/gnosi/pipeline/sandbox/notion_db_schema_to_gnosi_table.py \
  --notion-db-id 11c268e5-2714-81c1-9d48-d2fd9752c407 \
  --views-from-snapshot monorepo/apps/gnosi/pipeline/.tmp/notion_page_exports_test/11c268e5-2714-80a6-beb6-f8492a8a28c9.json \
  --dry-run

python monorepo/apps/gnosi/pipeline/sandbox/notion_db_schema_to_gnosi_table.py \
  --notion-db-id 90e31c41f815489b99f30086b120cbfa \
  --create-default-template \
  --template-title "Plantilla base" \
  --template-content "## Instruccions\n- Completa els camps obligatoris." \
  --dry-run
```

## 8. Pre-Execution Checklist

- [ ] `NOTION_TOKEN` disponible a l'entorn.
- [ ] `vault_db_registry.json` localitzat i accessible.
- [ ] ID de Notion validat.

## 9. Post-Execution Checklist

- [ ] Taula present a `registry.tables`.
- [ ] Tipus de propietats revisats.
- [ ] Backup generat quan no es dry-run.

## 10. Additional Notes

No importa contingut de registres: nomes crea/actualitza metadades d'esquema per la taula.
