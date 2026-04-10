# DIRECTIVE: GNOSI_MIGRATION_FROM_NOTION

> ID: 2026-04-07
> Associated Script: monorepo/apps/gnosi/pipeline/skills/notion_migration/scripts/notion_to_gnosi_full_import.py
> Last Update: 2026-04-07
> Status: ACTIVE (Migration Tool)

---

## 1. Objectius i Abast

- **Objectiu Principal:** Sincronitzar i migrar les bases de dades de Notion cap a un vault local de Gnosi, resolent relacions i convertint el contingut a format Markdown/BlockNote sobirà.
- **Criteris d'Èxit:** 
    - Generació de fitxers Markdown amb `id` persistent al frontmatter.
    - Descàrrega d'actius (imatges/fitxers) al Vault local per eliminar la dependència del núvol de Notion.
    - Integració amb l'índex global de Gnosi per permetre la navegació nativa.

## 2. Especificacions d'I/O

### Inputs
- **Variables d'Entorn:**
    - `NOTION_TOKEN`: Per a la lectura de la font externa.
    - `DIGITAL_BRAIN_VAULT_PATH`: Ruta al vault local de Gnosi (e.g., OneDrive).
- **Mapeig de Bases de Dades:** Configurat al script per identificar quines taules de Notion corresponen a quines carpetes de Gnosi.

### Outputs
- **Artefactes Generats:**
    - Fitxers `.md` a `[Vault_Path]/[Carpeta]/*.md`.
    - Actius locals a `[Vault_Path]/Assets/*`.
    - Actualització de `vault_db_registry.json`.

## 3. Flux Lògic (Algoritme)

1. **Inicialització:** Validar connexió i carregar el registre de bases de dades de Gnosi.
2. **Setup:** Preparar l'estructura de carpetes al Vault si és la primera importació.
3. **Iteració de Bases de Dades:**
    - Obtenir pàgines de Notion.
    - Convertir blocs de Notion a format Markdown enriquits per Gnosi (columnes, toggles, etc.).
    - Descarregar i localitzar imatges.
    - Guardar fitxer amb metadades YAML.
4. **Actualització del Registre:** Reflectir noves vistes o taules descobertes.

## 4. Restriccions i Casos de Cantonada

- **Lògica de Migració:** Un cop una nota és al Vault, Gnosi permet editar-la de manera independent. Cal tenir cura de no sobrescriure canvis locals amb noves importacions si s'ha decidit tallar el cordó amb Notion.
- **UUIDs de Sistema:** L'ID de Notion es guarda com a `id` al frontmatter per mantenir la integritat de les relacions històriques.
- **Formats Especials:** El script converteix elements complexos de Notion (`column_list`, `synced_block`) a sintaxi Markdown pròpia de Gnosi.

## 5. Protocol d'Errors i Aprenentatge (Memòria Viva)

| Data | Error Detectat | Causa Arrel | Solució/Patch Aplicat |
| --- | --- | --- | --- |
| 03/04/26 | Camps buits | Tipus `rich_text` no exportat | Afegida extracció explícita per a `rich_text` i `button`. |
| 07/04/26 | Identitat duplicada | "Gnosi" es deia "Digital Brain" | Rebranding total: el projecte es diu GNOSI, el backup es diu MIGRACIÓ. |
