# Notion Universal Page Architecture

## Core Directives

1. **No Filesystem Hierarchy**: The system will no longer rely on OS-level folders (like `Notes/`, `Projectes/`) to define structure. 
2. **"Everything is a Page"**: The fundamental unit of the system is the `Page`. 
   - A Workspace is a container of Pages.
   - A Page possesses a unique `id` (UUID), a `title`, and a `parent_id` (which links it to its container or parent Page).
   - Pages are stored physically as `.md` files (e.g., `<uuid>.md`) in a flat structure inside the workspace directory.
3. **Database as a Page Attribute**: A Database is NOT a separate physical entity like a folder. It is simply a `Page` that has an `is_database: true` flag in its frontmatter. 
   - When a Page is a database, its frontmatter defines the `schema` (types of properties its children can have) and `views` (filters/sorting/layout configurations).
   - Other Pages can declare this Database Page as their `parent_id`. Doing so makes them "records" or "items" of that database, and their frontmatter will include a `properties` dictionary matching the Database's schema.
4. **Inline Views**: Any Page can embed a view of any Database by including a custom block (e.g., `<database-view db="<uuid>" />`) in its Markdown body.

## Frontmatter Schema Standards

**Regular Page (Root or Child of another regular page):**
```yaml
id: "uuid-1234"
title: "La Meva Pàgina"
parent_id: null  # null means it's a root page shown at the top of the Sidebar
icon: "📄"
cover: null
```

**Database Page:**
```yaml
id: "uuid-db-1"
title: "Bitàcora"
parent_id: null
is_database: true
schema:
  estat: { type: "select", options: ["Obert", "Tancat"] }
  tags: { type: "multi_select" }
views:
  - id: "view-1"
    name: "Taula General"
    type: "table"
templates:
  - id: "tpl-1"
    name: "Nova Entrada Diària"
    content: "..."
```

**Database Item (Page inside a Database):**
```yaml
id: "uuid-item-1"
title: "Entrada del 24 de febrer"
parent_id: "uuid-db-1"
properties:
  estat: "Obert"
  tags: ["idea", "reflexió"]
```

## Restrictions / Edge Cases
- **Note**: Do not use the physical name of the file to determine the page title. The file name MUST be the UUID (`<uuid>.md`) to avoid naming collisions and URL breaking when renaming. The `title` property in the YAML is the sole source of truth for the name.
- **Note**: To move a page from one Database to another, or to make it a root page, simply change its `parent_id` and remove or adapt its `properties`.
- **Note**: The backend API must expose a flat index endpoint `GET /pages` that returns the metadata for all pages, effectively replacing `GET /all-notes`. The frontend can then build the tree structure (`children` computation) in memory.
