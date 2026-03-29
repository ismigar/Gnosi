# DIRECTIVE: vault_templates

> ID: vault_templates
Last Update: 2026-02-25
Status: ACTIVE
> 

---

## 1. Objectives and Scope

*Describe here WHAT this task should achieve and WHY.*

- **Main Objective:** Enable the creation and application of templates for records associated with a specific Table within the 4-layer database architecture of the Vault.
- **Success Criteria:** Users can define templates for a Table, and when creating a new record for that Table, they can choose to apply a template, which pre-fills properties (frontmatter) and content (body).

## 2. Input/Output (I/O) Specifications

### Inputs
- **Frontend Action:** User clicks "New Record" in a VaultTable view, or "Create Template" in the Table schema/options.
- **Backend API:** `/api/vault/tables/{table_id}/templates` to list and create templates.

### Outputs
- **Storage:** Templates are stored in the Vault just like regular pages but with specific metadata (`is_template: true`, `database_table_id: [table_id]`).
- **UI:** A modal or dropdown to select a template when creating a new record.

## 3. Logical Flow (Algorithm)

1. **Template Creation:**
   - A user defines a template for a specific `table_id`.
   - The frontend sends a POST request to create a new page with `is_template: true` and the corresponding `database_table_id`.
2. **Template Retrieval:**
   - When viewing a Table, the frontend fetches available templates for that `table_id` by querying pages with `is_template: true` and the matching `database_table_id`.
3. **Template Application (Record Creation):**
   - When creating a new record, the user selects a template.
   - The frontend fetches the template's full content (frontmatter and body).
   - A new page is created using the template's properties (potentially overriding or merging with default properties) and body content.

## 4. Tools and Libraries

- **Backend:** FastAPI, Python `pathlib`, `yaml`.
- **Frontend:** React, standard fetch/axios.

## 5. Restrictions and Edge Cases

- **Template Visibility:** Templates should usually be hidden from standard Vault exploration unless filtering or viewing a specific "Templates" management UI. They are technically standard `.md` files in the Vault.
- **Property Updates:** If a Table's schema changes, existing templates might have outdated properties. The system should gracefully ignore or prompt to update. For now, rely on standard schema enforcement.
- **Self-Referencing Filters:** Templates can include database views with a dynamic filter using `{{self}}` (or `__SELF__`). This placeholder is resolved at runtime to the current page's ID. This is ideal for "Notes of this Resource" or "Tasks of this Project" views within a template.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| | | | |

## 7. Examples of Use

- `POST /api/vault/pages` with `is_template: true` and `database_table_id: "uuid"`
- Dry-run import from Notion templates per table:
   - `python3 monorepo/apps/gnosi/pipeline/sandbox/import_notion_templates_per_table.py --dry-run`
- Apply import to Vault:
   - `python3 monorepo/apps/gnosi/pipeline/sandbox/import_notion_templates_per_table.py --apply`

## 7.1 Notion Template Import SOP

1. Read local tables from `GET /api/vault/registry`.
2. Discover Notion databases by table name using `POST /v1/search` (filter `object=database`).
3. Query pages per Notion database and detect template rows conservatively:
    - Checkbox properties with names containing `template|plantilla|plantilles` set to `true`.
    - Select/status properties with names containing `template|plantilla|plantilles` whose value contains `template|plantilla`.
4. Build markdown content from Notion blocks.
5. De-duplicate against existing Vault templates using `metadata.notion_id`.
6. Create templates via `POST /api/vault/pages` with metadata:
    - `is_template: true`
    - `database_table_id` and `table_id` of the target table
    - `notion_id` and `notion_database_id` for traceability
7. Write a JSON report to `.tmp` before/after apply.

Safety rules:
- Default execution is dry-run.
- Ignore stale TLS env vars (`REQUESTS_CA_BUNDLE`, `SSL_CERT_FILE`) if paths are invalid.
- Never overwrite existing templates; only create missing ones.

## 8. Pre-Execution Checklist

- [x] Review `VaultTable` and backend routes.
- [ ] Define precise API for fetching templates.

## 9. Post-Execution Checklist

- [ ] Templates can be created from the UI.
- [ ] Templates can be selected when creating a record.
- [ ] Selected template correctly populates properties and content.
