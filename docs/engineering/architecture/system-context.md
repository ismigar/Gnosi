---
status: implemented
last_verified: 2026-08-02
source_paths:
  - backend/server.py
  - frontend/src/App.jsx
  - frontend/vite.config.js
  - docker-compose.yml
  - desktop/main.js
tests:
  - backend/tests
  - tests/e2e/tests/anon/smoke.spec.ts
---

# System context

## Container view

```mermaid
flowchart LR
    User["User or team member"] --> UI["React and Vite frontend"]
    UI -->|HTTP /api and WebSocket| API["FastAPI backend"]
    API --> Vault["Markdown vault and assets"]
    API --> Local["Local-only SQLite, indexes, caches, secrets"]
    API --> MCP["MCP servers and AI providers"]
    API --> Comms["Mail, calendar, contacts providers"]
    API --> Zotero["Zotero translation-server"]
    API --> Publish["Notion, Drupal, and social services"]
    Desktop["Electron desktop shell"] --> UI
    Desktop --> API
    Office["Office add-ins and web clipper"] --> API
```

## Frontend boundary

The frontend is a React single-page application. `App.jsx` owns the top-level
browser routes, authentication gate, global shell, lazy route loading, toasts,
agent chat, command palette, meeting recorder, reminders, and desktop update
notice. Vite proxies `/api` and WebSocket traffic to the backend during native
development.

Pages compose reusable components; components call the backend through shared
helpers or direct fetch calls. The frontend is not trusted to authorize a
workspace, vault, user, or destructive operation. Client identifiers are
signals that the backend resolves and validates.

## Backend boundary

`backend/server.py` creates the FastAPI application and registers domain
routers. Route modules translate HTTP contracts into service calls. Business
logic belongs in `backend/services/`; persisted relational entities live in
`backend/models/`; AI orchestration lives in `backend/agent/`; scheduled work
lives in `backend/scheduler/` and runtime skills.

The application lifespan starts shared infrastructure, constructs agent
capabilities, warms safe indexes, starts mail IDLE workers, and later closes
those resources. Optional integration startup is isolated so one unavailable
provider does not abort the whole server.

## Storage boundaries

The vault and local data have deliberately different durability and
synchronization properties:

- Vault: portable user content; may live on local disk or a cloud-backed file
  provider.
- Local data: SQLite, indexes, caches, secrets, logs, checkpoints, and outputs;
  never cloud-synchronized.
- Configuration: merged from application defaults, user or vault parameters,
  environment overrides, and local credential stores.

See [data and storage](data-and-storage.md) for ownership and rebuild rules.

## External systems

All external services are optional domain dependencies. OAuth and credentials
are managed locally. Adapters normalize provider-specific behavior for Google,
Microsoft, IMAP/SMTP, CalDAV, Notion, Drupal, AI providers, social networks,
file providers, and Zotero translation.

## Navigation to implementation

- [API catalog](../generated/api-catalog.md)
- [Frontend catalog](../generated/frontend-catalog.md)
- [Backend module catalog](../generated/backend-modules.md)
- [Configuration catalog](../generated/configuration.md)
