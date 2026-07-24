# Directive: Configurable Notion import schema

## Objective

The Notion import modal lets users configure each database through Gnosi's
existing schema editor, including field types and attachment destinations.
Loose pages can be classified individually as Wiki pages or dashboards. This
replaces blind schema detection.

## Existing building blocks

- `SchemaConfigModal` accepts `currentSchema` and
  `onSave(newSchema, options)` and already supports Gnosi field types.
- `files` and `image` fields support `storage_folder`, `file_mode`, and
  `name_pattern`.
- Asset helpers create
  `Assets/<database>/<table>/<property>/` directories.
- `metadata.is_dashboard = true` selects dashboard storage; Wiki is the
  default.

## Frontend

1. For each selected database, expose a settings action that opens
   `SchemaConfigModal`.
2. Load converted Notion schema from
   `GET /api/notion/databases/{id}/schema`.
3. Save user changes under `schemaOverrides[databaseId]`.
4. List loose pages and provide a per-page Wiki/Dashboard selector.
5. Send `schema_overrides` and
   `loose_page_types = {notion_page_id: "wiki" | "dashboard"}` to import and
   clone endpoints.

## Backend

- Accept schema and loose-page overrides in import and clone requests.
- Build table properties from the override when present. The user-selected
  type and storage settings take precedence over automatic mapping.
- In `notion_attachments.py`, download Notion-hosted field and body assets
  immediately before signed URLs expire. Store them in the configured asset
  directory, append a stable hash to collisions, and rewrite values and
  Markdown to local `Assets/...` paths.
- Pass each loose-page classification to `create_page`.

## Completed phases

1. Configurable schema endpoint, modal reuse, payload, and backend override.
2. Attachment download and localization through `notion_attachments.py`.
3. Per-page Wiki/Dashboard classification and the loose-page clone pass.

## QA

- Pure tests cover Notion-to-modal and modal-to-property conversion.
- Downloader tests verify destination and rewritten references.
- End-to-end clone changes a field type and attachment folder, then verifies
  the Vault schema and localized file.
