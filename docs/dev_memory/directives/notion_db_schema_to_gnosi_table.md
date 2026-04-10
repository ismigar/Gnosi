# DIRECTIVE: GNOSI_MIGRATION_SCHEMA_IMPORT

> ID: 2026-04-07
> Associated Script: monorepo/apps/gnosi/pipeline/sandbox/notion_db_schema_to_gnosi_table.py
> Last Update: 2026-04-07
> Status: ACTIVE (Migration Phase)

---

## 1. Objectius i Abast

- **Objectiu Principal:** Importar l'esquema d'una base de dades de Notion per crear o actualitzar la definició de taula al `vault_db_registry.json` de Gnosi.
- **Criteris d'Èxit:**
  - Generació d'una entrada `table` vàlida amb les propietats (camps) originals.
  - Creació de plantilles base a Gnosi vinculades a la nova taula.
  - **Sobirania:** Un cop importat l'esquema, la taula a Gnosi es considera la font de veritat i no depèn de Notion per a la seva operativitat diària.

## 2. Especificacions d'I/O

### Inputs
- **Environment Variables:** `NOTION_TOKEN`.
- **Arguments clau:**
  - `--notion-db-id`: ID de la font original.
  - `--gnosi-db-id`: ID del destí al Vault local.
  - `--import-views`: Opcional, per intentar replicar la visualització.

### Outputs
- **Artefactes:**
  - Actualització de `vault_db_registry.json`.
  - Backup de seguretat automàtic `.bak`.

## 3. Flux Lògic

1. **Adquisició de l'Esquema:** Consulta a l'API de Notion per obtenir les propietats.
2. **Conversió de Tipus:** Mapeig de tipus Notion (e.g., `multi_select`) a tipus compatibles amb Gnosi.
3. **Registre al Vault:** Upsert de la taula al registre central de bases de dades de Gnosi.
4. **Plantilles:** Creació de plantilles de pàgina per a la nova taula per facilitar la creació de dades natives.

## 4. Restriccions i Casos de Cantonada

- **Sols Metadades:** Aquest script NO importa el contingut (files), només l'estructura.
- **Unidireccional:** La importació de l'esquema s'ha de fer un sol cop per cada base de dades per evitar sobreescriure personalitzacions fetes directament a Gnosi.
- **Tipus de Sistema:** Les propietats de sistema de Notion (`created_by`, etc.) es converteixen en camps de dades estàndard a Gnosi.

## 5. Protocol d'Errors i Aprenentatge

| Data | Error Detectat | Causa Arrel | Solució/Patch Aplicat |
| --- | --- | --- | --- |
| 27/03/2026 | Script inexistent | No s'havia implementat | Creació del script amb suport per dry-run i backups. |
| 07/04/2026 | Dependència continuada | Por a perdre la sincronització | Canvi de focus: un cop importat l'esquema, Gnosi és SOBIRÀ. |
