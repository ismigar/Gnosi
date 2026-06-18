# Architecture

This document explains how Gnosi is put together so you can find your way around the codebase and make changes with confidence. For setup and conventions, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Design principles

- **Local-first / data sovereignty.** The source of truth is a folder of Markdown files on disk. Everything else (indexes, the management database, caches) is derived and can be rebuilt. Your notes remain portable Markdown.
- **Zero overhead for a single user.** In `personal` mode there is no login, no auth, and collaboration is off. Multi-user features are strictly opt-in (`org` mode).
- **Non-breaking evolution.** New multi-user capabilities (auth, workspaces, collaboration) are layered so that existing single-user installs keep working unchanged.
- **Free software, all the way down.** AGPL-3.0-or-later; a hosted Gnosi must remain free software for its users.

## High-level shape

```
┌──────────────────────────┐        ┌─────────────────────────────────────┐
│  Frontend (React + Vite) │  HTTP  │  Backend (FastAPI / uvicorn)         │
│  - BlockNote editor      │ <────> │  - api/ route modules (HTTP + WS)    │
│  - Sigma.js graph        │  /api  │  - services/ (business logic)        │
│  - pages/ + components/  │  + WS  │  - agent/ (LangGraph + MCP)          │
└──────────────────────────┘        │  - scheduler/ (background jobs)      │
                                     └───────────────┬─────────────────────┘
                                                     │
                        ┌────────────────────────────┼─────────────────────────┐
                        │                            │                          │
                ┌───────▼────────┐         ┌─────────▼─────────┐      ┌─────────▼──────────┐
                │ Markdown Vault │         │ Management DB     │      │ translation-server │
                │ (source of     │         │ (SQLite: users,   │      │ (Zotero sidecar,   │
                │  truth, on disk)│        │  workspaces, ...) │      │  web capture)      │
                └────────────────┘         └───────────────────┘      └────────────────────┘
```

## Repository layout & publishing

In this public repository the app lives at **`apps/gnosi/`** — backend, frontend, pipeline, and the Electron desktop wrapper. It is mirrored from a development monorepo via `.github/workflows/sync.yml`, and it is what the release workflow packages into the desktop installers.

```
apps/gnosi/
├── backend/      FastAPI application
├── frontend/     React + Vite SPA
├── electron/     Electron desktop wrapper (packaged installers)
└── pipeline/     Python "skills" — analysis, integrations, idempotent scripts
```

## Backend (FastAPI)

The app is created in `backend/server.py`. Its `lifespan` startup sequence wires the moving parts:

1. **Scheduler** — background job manager starts.
2. **MCP client** — connects to configured Model Context Protocol servers and discovers tools.
3. **Agent graph** — a LangGraph workflow is built from the discovered tools.
4. **Vault index warmup** — the page index is preloaded from a disk cache (sync) and then refreshed against the filesystem (async), plus a wikilink-index rebuild so renames rewrite links.
5. **IMAP IDLE workers** — one daemon per mail account holds an open IDLE connection for real-time push.

### Route modules (`backend/api/`)

Routers are registered in `server.py`. They cover the full product surface:

| Area | Modules |
| --- | --- |
| Notes / Vault | `vault_routes`, `vault_graph_routes`, `vault_views_routes` |
| Collaboration | `collab_routes` (WebSocket presence + relay) |
| References / Reader | `reader` (PDF/EPUB), plus citation endpoints in `vault_routes` |
| Mail / Calendar / Contacts | `mail_routes`, `calendar_routes`, `contacts_routes` |
| Auth / Identity | `auth_routes` (JWT), `identity_routes`, `google_auth_routes`, `microsoft_auth_routes` |
| Workspaces | `workspace_routes` |
| AI / Agent / Tools | `agent_routes`, `ai_routes`, `tools_routes` |
| Social / Scheduler / Analytics | `social_routes`, `scheduler_routes`, `analytics_routes` |
| Platform | `system_routes`, `config_routes`, `env_routes`, `credentials_routes`, `integrations_routes` |

Business logic lives in `backend/services/`; SQLAlchemy models in `backend/models/`; the agent in `backend/agent/`.

### Storage

- **Vault** — Markdown files on disk (path configured per install). This is the source of truth for notes.
- **Management database** — SQLite, under the local-only data directory. Holds users, workspaces, memberships, and similar relational state. **Never** place it on cloud-synced storage (SQLite + sync = corruption).
- **Derived indexes** — page index and wikilink index are caches rebuilt from the vault.

## The Vault

Notes are Markdown with YAML frontmatter. On top of the files, Gnosi maintains:

- a **page index** (fast listing/search without scanning the filesystem each request),
- a **wikilink index** (so renaming a page can rewrite inbound `[[links]]`),
- a **views registry** — the database/table views (Notion-style) layered over folders of notes. Every table is guaranteed at least one "main" view (a startup repair pass enforces this invariant).

Writes use **ETag** checks to detect concurrent modification.

## Reference manager (Zotero-compatible)

Gnosi includes a built-in reference manager rather than depending on the Zotero app:

- **Citations** use a CSL/citeproc engine with a pinned copy of Zotero's schema; references can be imported by DOI / ISBN / arXiv / PMID and normalized into a common item model.
- **Web capture** is powered by the official Zotero **`translation-server`** running as a Docker sidecar (internal-only; the backend calls it).
- **Reading** happens in-app via a bundled PDF/EPUB reader (built from a submodule — see the first-time setup in the README). PDF annotations can be promoted into citable quotes.

## Multi-tenancy, auth & permissions

Gnosi has two operating modes (`gnosi_mode`):

- **`personal`** — single user, no auth. The backend bypasses authentication entirely; the frontend never shows a login.
- **`org`** — multi-user. Login is required and requests are authenticated.

The relational model (in `backend/models/`) is **Workspace → Membership → VaultAccess**, with role-based access control. Roles are ordered by weight:

`viewer < editor < admin < owner`

Authentication uses **JWT** (HS256) carried in an **HttpOnly session cookie** (`SameSite=Lax`), with `Authorization: Bearer` also accepted. Because the frontend and API are served same-origin (Vite proxies `/api` in dev; a reverse proxy/static serve in prod), the cookie is sent automatically. A backward-compatible resolver prioritizes a valid JWT, then a legacy `X-User-ID` header, then a default identity — and personal mode is never gated.

> Security rule: never trust a `workspace_id` (or `user_id`) sent by the client without validating permissions on the server.

## Real-time collaboration

Collaboration follows a **central-relay** model (server as message hub), implemented in `backend/api/collab_routes.py` and the frontend `useCollaboration` hook:

- A WebSocket per page (`/api/vault/collab/{page_id}`) tracks **presence** (who is on the page) and **relays** arbitrary messages to the other peers.
- Identity is taken from the session cookie when available, otherwise from a query parameter (the module degrades gracefully if the auth layer is absent).
- This is an early skeleton: the same channel is designed to carry full **CRDT** (Yjs) document updates next — adding a `type: "update"` message requires no transport changes. Planned: per-workspace authorization of the socket, rate limiting, and a shared backend (e.g. Redis pub/sub) for multi-worker deployments.

## AI agent

A multi-agent workflow built with **LangGraph** can plan and execute tasks using tools exposed through the **Model Context Protocol (MCP)**. Models can be local (Ollama) or any OpenAI-compatible endpoint. The agent is constructed at startup from the discovered MCP tools.

## Frontend (React + Vite)

- **Editor** — BlockNote (`@blocknote/*`), a block-based WYSIWYG editor over Markdown, with multi-column support.
- **Graph** — Sigma.js renders the knowledge graph.
- **Structure** — top-level views in `frontend/src/pages/` (Vault, Graph, Mail, Calendar, Contacts, Reader, Social, Scheduler, …) and reusable UI in `frontend/src/components/` (e.g. `Vault/`, `Mail/`).
- **API access** — a shared fetch helper sends credentials (the session cookie) and the current user id. In dev, Vite proxies `/api` (HTTP and WebSocket upgrades) to the backend.

## Where to add things

- **A new API surface** → add a `*_routes.py` in `backend/api/`, register it in `server.py`, put logic in `backend/services/`.
- **A new persisted entity** → add a model in `backend/models/`. There is no migration framework; additive columns are handled by a lightweight idempotent `ALTER TABLE` pass at startup.
- **A new view/page** → add to `frontend/src/pages/` and wire navigation; reusable pieces go in `frontend/src/components/`.
- **A reusable script/tool** → follow the `pipeline/skills/` convention (see [CONTRIBUTING.md](CONTRIBUTING.md)).
