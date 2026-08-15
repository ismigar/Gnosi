# Gnosi

[English](README.md) · [Català](README.ca.md) · [Español](README.es.md)

**From source to manuscript, with your knowledge always yours.**

Gnosi is a local-first, open-source research workspace. It connects references,
PDF/EPUB/web evidence, Markdown notes, project structure, knowledge graphs and
verifiable citations without making a SaaS the owner of your work.

> [!IMPORTANT]
> Gnosi uses regular Markdown and YAML files as its source of truth. Your notes
> remain readable, portable, versionable and recoverable outside the app.

## The research workflow

1. **Capture or import** — DOI, ISBN, arXiv, PMID, BibTeX, RIS, web pages,
   PDFs, EPUBs, feeds and other research material.
2. **Read with evidence** — preserve annotations and quotations with page,
   paragraph, chapter, line or timestamp provenance.
3. **Connect and structure** — turn reading notes into human-authored synthesis
   using wikilinks, the graph, typed databases, boards, calendars and timelines.
4. **Write and cite** — insert active citations into Word or LibreOffice and
   generate bibliographies with CSL/citeproc.

AI can help ingest, search and organize sources through local or cloud models,
but it is optional. Gnosi distinguishes evidence-bearing reading notes from the
permanent notes that express your own conclusions.

## Why Gnosi exists

Gnosi began as a personal answer to a fragmented workflow: Notion offered
structured databases and project views; Obsidian offered Markdown and a graph;
Mendeley managed references. The same sources and ideas had to be duplicated,
while years of knowledge depended on closed products and changing policies.

Gnosi brings that chain together in an open system. It is shared as a community
project, not presented as a finished company or a universal replacement for
every tool.

## Core capabilities

- Block editor over portable Markdown and YAML.
- Typed databases with relations, formulas, rollups and saved views.
- Interactive knowledge graph and optional semantic suggestions.
- Native reference manager with Zotero-compatible capture and CSL citations.
- Integrated PDF/EPUB reader with evidence-preserving annotations.
- Word and LibreOffice citation add-ins.
- Research planning with dependencies, resources, deadlines and timelines.
- Multi-provider agents, plugins and MCP tools with explicit governance.
- Personal local-first mode and optional self-hosted organization mode.

Mail, calendar, contacts, feeds, translation and publishing integrations also
exist, but the primary product path is research: source → evidence → synthesis →
citation.

## Try the multilingual research workspace

The official signed template demonstrates the full path in English, Catalan and
Spanish without requiring an AI provider or an external account.

1. Open **Settings → General → Files**.
2. Under Vaults, choose **From repository**.
3. Select **Research Starter Workspace** and create the new Vault.
4. Open the “Start here” note in your language.

## Download the desktop app

Download the latest macOS, Windows or Linux build from
[GitHub Releases](https://github.com/ismigar/Gnosi/releases/latest). The backend
is bundled, so the desktop path does not require a Python or Node setup.

> [!WARNING]
> Desktop builds are currently beta and unsigned. On macOS, use right-click →
> Open the first time. Review the release notes before using Gnosi with your
> only copy of important material.

## Self-host or contribute

The commands below are for development and self-hosting. Native execution is
recommended; Docker remains a supported deployment option for servers.

### Prerequisites

- Python 3.10+
- Node.js and npm
- Optional: Docker for the containerized deployment
- Optional: Ollama or another supported model provider for AI features

Initialize the reader bundle once:

```bash
git submodule update --init --recursive
sh apps/gnosi/sh/build-zotero-reader.sh
```

### Run natively

```bash
cd apps/gnosi
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.server:app --host 0.0.0.0 --port 5002 --reload
```

In another terminal:

```bash
cd apps/gnosi/frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

### Run with Docker (optional)

```bash
cd apps/gnosi
docker compose up -d --build
```

## Architecture and documentation

- Application: [`apps/gnosi/`](apps/gnosi/)
- Architecture: [`apps/gnosi/ARCHITECTURE.md`](apps/gnosi/ARCHITECTURE.md)
- Contribution guide: [`apps/gnosi/CONTRIBUTING.md`](apps/gnosi/CONTRIBUTING.md)
- Public engineering portal: [gnosi.temenosismael.org/engineering](https://gnosi.temenosismael.org/engineering/)

## Feedback and contribution

If you try Gnosi, the most useful feedback is where the chain breaks: install,
source import, evidence traceability, synthesis, or citation. Open a
[feedback issue](https://github.com/ismigar/Gnosi/issues/new?labels=feedback&title=%5BFeedback%5D%20My%20first%20Gnosi%20workflow)
or see the [contribution guide](apps/gnosi/CONTRIBUTING.md). Maintainers can use
the ready-to-publish [community release kit](apps/gnosi/docs/community/community-release.md).

## License

Copyright © 2024–2026 Ismael García Fernández.

Gnosi is distributed under the
[GNU Affero General Public License v3.0 or later](LICENSE). You may use, modify
and redistribute it under the terms of that license, including its source
availability obligations for network use.
