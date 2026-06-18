# Gnosi

**Gnosi is a local-first, open-source workspace — a self-hostable alternative to Notion and Obsidian.**

It turns a plain folder of Markdown files into a connected workspace: a block editor, database-style table views, an interactive knowledge graph, an integrated reference manager, and email/calendar/contacts — all running on **your** machine, against **your** files.

> [!IMPORTANT]
> **Data sovereignty by design.** Gnosi is local-first and operates directly on your filesystem. Your notes stay as portable Markdown you can read, back up, and version with any tool. No vendor lock-in.

## Why Gnosi

Most "second brain" tools are either closed SaaS (your data lives on someone else's servers) or single-user desktop apps (no real collaboration). Gnosi aims for a third path: **a workspace that teams and cooperatives can self-host and own**, released under the AGPL so that any hosted version stays free software for its users.

It is being prepared for use by cooperatives that want a shared, auditable, vendor-neutral knowledge base.

## ✨ Features

- **Block editor** — a Notion-style WYSIWYG editor (BlockNote) over standard Markdown files. Slash commands, multi-column layouts, embeds.
- **Database / table views** — turn folders of notes into filterable, sortable tables with typed columns and saved views (table, gallery, kanban, calendar, timeline).
- **Knowledge graph** — an interactive graph (Sigma.js) of wikilinks and tags, with optional AI-assisted semantic connections.
- **Integrated reference manager** — a Zotero-compatible citation engine (CSL/citeproc), import by DOI/ISBN/arXiv/PMID, web capture, an in-app **PDF/EPUB reader**, and PDF annotations that become citable quotes. Word & LibreOffice cite add-ins included.
- **Mail, Calendar & Contacts** — IMAP/SMTP mail with real-time push (IMAP IDLE), calendar, and contacts; Google and Microsoft OAuth supported.
- **AI agent** — a multi-agent workflow (LangGraph) that can use tools via the Model Context Protocol (MCP) and local or cloud LLMs. Bring your own provider (Ollama, OpenAI, Anthropic, Groq, Gemini…).
- **Translation & publishing** — translate notes and whole pages (Softcatalà, local OPUS-MT, DeepL), sync content to Drupal, and post to Mastodon, Bluesky and Telegram.
- **Real-time collaboration** *(early)* — live presence on a page; the channel is designed to carry full CRDT editing next.
- **Multi-user & workspaces** *(opt-in)* — JWT authentication, workspaces, and role-based access control (owner / admin / editor / viewer). Disabled by default in single-user "personal" mode.

## 🏗️ Architecture

- **Backend** — Python **FastAPI** (served by `uvicorn`), with a SQLite "management" database for users/workspaces and an on-disk Markdown vault as the source of truth.
- **Frontend** — **React + Vite** (BlockNote editor, Sigma.js graph).
- **Reference capture** — a Zotero `translation-server` sidecar powers web import (run it natively or via Docker).

The application lives in [`apps/gnosi/`](apps/gnosi/). See [ARCHITECTURE.md](apps/gnosi/ARCHITECTURE.md) for the full picture and [CONTRIBUTING.md](apps/gnosi/CONTRIBUTING.md) to start hacking.

## 🚀 Quick start

**Prerequisites:** Python 3.10+, Node.js & npm. *(Optional)* Docker, and [Ollama](https://ollama.com/) or any OpenAI-compatible API for local AI features.

First-time setup builds the Zotero PDF/EPUB reader bundle once (build artifacts are not committed):

```bash
git submodule update --init --recursive
sh apps/gnosi/sh/build-zotero-reader.sh
```

### Run natively (recommended)

```bash
# Backend — FastAPI on uvicorn (port 5002)
cd apps/gnosi
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn backend.server:app --host 0.0.0.0 --port 5002 --reload

# Frontend — Vite dev server (port 5173), in another terminal
cd apps/gnosi/frontend
npm install
npm run dev
```

Then open `http://localhost:5173`.

### Run with Docker (optional)

Prefer a single command, or deploying on a server?

```bash
cd apps/gnosi
docker-compose up -d --build
```

This bundles the backend, frontend, and the Zotero translation-server together.

## ⚙️ Configuration

- **Vault path** — point Gnosi at your Markdown folder via `params.yaml` (or the relevant `VAULT` setting). Keep the vault out of the local-only data directory; never put the SQLite database on cloud-synced storage.
- **Credentials** — API keys and integration tokens (mail, Google/Microsoft, AI providers) are managed from **Settings → Credentials** in the UI, and can also be provided via environment variables (`.env_shared` for shared values, `.env` for local overrides).

### Personal vs. Organization mode

Gnosi runs in one of two modes (`gnosi_mode`):

- **`personal`** *(default)* — a single user, no login, zero auth overhead. Collaboration and workspace gating are off.
- **`org`** — multi-user: login is required, requests are authenticated with a JWT session cookie, and workspace membership / roles are enforced. Real-time presence activates here.

## 📂 Repository layout

```
apps/gnosi/          # The Gnosi app
├── backend/         # FastAPI: routes (api/), services, models, agent, scheduler
├── frontend/        # React + Vite (BlockNote editor, Sigma.js graph)
└── pipeline/        # Python skills/scripts (analysis, integrations, tools)
packages/            # Shared MCP servers and packages
scripts/             # Repo tooling
```

## 🤝 Contributing

Contributions are welcome — see [CONTRIBUTING.md](apps/gnosi/CONTRIBUTING.md) for setup, conventions, and the review process.

## 📄 License

Distributed under the **GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later). See [LICENSE](LICENSE) for the full text.

In short: Gnosi is free software. You may use, modify, and redistribute it, including running it as a network service, **provided that any modifications you publish — or expose to users over a network — are also released under the same license**, with the corresponding source code available to those users. This is the same license Zotero, Mastodon, and Nextcloud use.
