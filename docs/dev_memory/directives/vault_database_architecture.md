# Directive: Vault Database Architecture (Gnosi)

This directive defines the architecture and protocol for managing structured databases within the Vault, overcoming the limitations of the Notion import connector through a decoupling of Data, Logic, and Presentation.

## 4-Layer Architecture

### 1. Database (Space/App)
High-level logical container that groups related tables by context (e.g., "Projects", "Accounting").
- **Structure:**
  ```json
  {
    "id": "uuid",
    "name": "Accounting",
    "icon": "💰",
    "tables": ["table_id_1", "table_id_2"]
  }
  ```

### 2. Table (Collection / Schema)
Defines the properties and data types. It is the "master" of the pages it contains.
- **Structure:**
  ```json
  {
    "id": "uuid",
    "database_id": "uuid",
    "name": "Movements",
    "properties": {
      "Amount": "number",
      "Date": "date",
      "Category": "select"
    }
  }
  ```
- **Inheritance:** Any page in the Vault associated with this `table_id` will inherit these properties in its metadata (Frontmatter).

### 3. View (Display / Query)
Specific display configuration for a table.
- **Structure:**
  ```json
  {
    "id": "uuid",
    "table_id": "uuid",
    "name": "Monthly Income",
    "type": "table | kanban | gallery",
    "filters": [
      { "property": "Amount", "operator": ">", "value": 0 }
    ],
    "sorts": [
      { "property": "Date", "direction": "desc" }
    ],
    "visible_properties": ["Amount", "Date"]
  }
  ```

### 4. Record (Page / Data)
The actual data are Markdown Pages with enriched metadata.
- **Link**: They are stored with a `database_table_id: uuid` property.
- **Unique Identifier**: The `id` key is always used to identify the record, unifying `source_id` or `notion_id`.
- **Flexibility**: As pages, they can contain free text, images, and blocks aside from structured properties.

## Development Protocols

- **Single Source of Truth**: The configuration of DBs (`vault_db_registry.json`) is stored in the Vault directory (or in the system configuration).
- **Idempotency**: When a property is added to a table, it is not necessary to immediately modify all pages. The editor must be able to detect the missing property and offer a default value.
- **UI Decoupling**: The `VaultTable` component should not know anything about files; it should only receive a list of objects (records) and a view schema.

## Restrictions and Edge Cases
- **Deletions**: If a View is deleted, nothing happens to the data. If a Table is deleted, confirmation must be requested whether to "unlink" the pages or delete them.
- **Type Changes**: Changing a field from "Text" to "Number" may require validation or data casting. For now, we will prioritize flexibility.
