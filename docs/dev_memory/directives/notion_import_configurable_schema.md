# Directiva: Import/Clon de Notion CONFIGURABLE (esquema per BD + wiki/dashboard)

**Objectiu:** el modal d'import de Notion ha de deixar a l'usuari **configurar l'esquema de
cada BD** amb el mateix formulari de camps de Gnosi (tipus per camp + on van els adjunts), i
marcar les **pàgines soltes com a wiki o dashboard**. Substitueix l'autodetecció cega.

## Punts clau (de l'exploració)
- **`SchemaConfigModal`** (frontend/.../Vault/SchemaConfigModal.jsx) JA és reutilitzable:
  props `currentSchema` ({campNom: tipus, campNom_config:{...}}) + **`onSave(newSchema, opts)`**
  (callback custom, pensat per a usos com l'import). Sub-fila `SortableField`.
  - Tipus disponibles: text, rich_text, number, select, multi_select, status, autoria, date,
    datetime, period, checkbox, url, zotero, **files, image**, relation, formula, rollup,
    virtual, created_*/last_edited_*, button, title.
  - Camps `files`/`image`: config amb **`storage_folder`** = "assets" (Assets/<DB>/<Taula>/<Prop>/)
    | "biblioteca" (Biblioteca compartida) | "free"; + `file_mode` (upload/link), `name_pattern`.
    → AIXÒ és "on van els adjunts" (per camp). No cal inventar res.
- **Adjunts**: `_is_asset_property` + carpetes auto `Assets/<DB>/<Taula>/<Prop>/`
  (`_ensure_asset_dirs_for_table_entry` a create_table). El clon ha de BAIXAR els fitxers S3 de
  Notion a la carpeta del camp i reescriure les rutes a `Assets/...` (caduquen ~1h).
- **Dashboard vs wiki**: `metadata.is_dashboard=true` → carpeta DASHBOARDS/ (.json); altrament
  WIKI/ o carpeta de taula (.md). "wiki" = per defecte (no hi ha etiqueta pròpia).

## Disseny

### Frontend (NotionImportSettings.jsx)
1. **Pas "Configura camps" per BD**: a la llista de BD seleccionades, botó ⚙ per BD →
   obre `SchemaConfigModal` amb `currentSchema` = esquema de Notion convertit al format del modal
   (via un nou `GET /api/notion/databases/{id}/schema` que torna map_property_schema → format
   `{nom:tipus, nom_config}`), `onSave` → desa l'override a `schemaOverrides[dbId]`.
   - Així l'usuari ajusta tipus + `storage_folder` per camp d'arxiu amb la UI que ja coneix.
2. **Pàgines soltes — PER PÀGINA** (decisió usuari 2026-06-27): llistar les pàgines soltes
   (`/search object=page` amb parent workspace/page) i, per CADA una, un selector **wiki/
   dashboard**. Payload `loose_page_types` = {notion_page_id: "wiki"|"dashboard"}.
3. Payload: `schema_overrides` (dict dbId→schema del modal) + `loose_page_types` (per pàgina)
   al `/import` i `/clone`.

### Backend
- `/import` i `/clone` accepten `schema_overrides` i `loose_pages_as_dashboard`.
- En clonar/importar una BD: si hi ha override, **construir la taula des de l'override**
  (convertir format modal → properties) en comptes de `map_database_schema` cru (o fusionar:
  override mana en tipus + storage_folder; la resta de map_database_schema).
- **Adjunts** (`services/notion_attachments.py` nou): per cada valor de camp `files`/`image` i
  per cada imatge del cos, baixar la URL (httpx, UA navegador) → carpeta del camp segons
  `storage_folder` (`_property_assets_dir`) amb nom = original + sufix hash; reescriure el valor
  / la ruta del Markdown a `Assets/...`. Fer-ho DURANT el fetch (abans que caduqui).
- Pàgines soltes: `metadata["is_dashboard"] = loose_pages_as_dashboard` → create_page les desa a
  DASHBOARDS/.

## Fases
1. ✅ **Esquema configurable** (PR #622): endpoint `/databases/{id}/schema` + SchemaConfigModal
   reutilitzat al modal (botó ⚙ per BD) + payload `schema_overrides` + backend `apply_override`.
2. ✅ **Adjunts** (PR #623): `notion_attachments.py` (download_to + localize_values/localize_body)
   + callback `save_asset` a clone_workspace → `Assets/<clon>/<Taula>/<Camp|_cos>/`.
3. ✅ **Wiki/dashboard PER PÀGINA**: endpoint `/loose-pages` (parent workspace/page) + selector
   wiki/dashboard per pàgina al modal + `loose_page_types` → 3a passada de clone_workspace
   (is_dashboard com a etiqueta, contingut sempre markdown).

## QA
- Conversió de format (Notion→modal i modal→properties): tests purs.
- Downloader: test amb URL fake + verificar destí + reescriptura.
- E2E: configurar una BD (canviar un tipus + storage_folder d'un camp file) → import/clon →
  verificar tipus al vault + adjunt baixat a la carpeta correcta.
