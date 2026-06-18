# Contributing to Gnosi

Thanks for your interest in improving Gnosi! This guide covers how to get a development environment running, the conventions we follow, and how to get a change merged.

Gnosi is **free software under the AGPL-3.0-or-later**. By contributing, you agree that your contributions are licensed under the same terms (see [License](#license)).

## Ways to contribute

- **Report bugs** — open an issue with steps to reproduce, what you expected, and what happened. Include your OS, whether you run via Docker or locally, and the relevant logs.
- **Propose features** — open an issue describing the problem you're trying to solve before writing code. Gnosi is local-first and privacy-respecting; features that phone home or assume a central server are usually out of scope.
- **Improve docs** — fixes to the README, [ARCHITECTURE.md](ARCHITECTURE.md), or this guide are very welcome.
- **Send a pull request** — see [Commit & pull request process](#commit--pull-request-process) below.

## Repository layout

The authoritative code lives at **`monorepo/apps/gnosi/`**. That's what Docker mounts, what the release workflow packages, and what the public mirror is synced from. Always make changes there.

```
monorepo/apps/gnosi/
├── backend/      # FastAPI app: api/ (routes), services/ (logic), models/, agent/, scheduler/
├── frontend/     # React + Vite SPA (BlockNote editor, Sigma.js graph)
├── pipeline/     # Python "skills" — analysis, integrations, idempotent scripts
└── e2e/          # Playwright end-to-end tests (host-level project)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together and where to add new things.

## Development setup

### Prerequisites

- **Python 3.10+**
- **Node.js** & **npm**
- **Docker** (recommended — it bundles backend, frontend, and the Zotero translation-server)

### First-time setup (fresh clone)

Build the bundled PDF/EPUB reader once (the build artifacts are not committed):

```bash
git submodule update --init --recursive
sh monorepo/apps/gnosi/sh/build-zotero-reader.sh
```

Without this step, documents in the vault return 404 in the reader. Re-run it whenever you update the submodule.

### Run with Docker (recommended)

```bash
cd monorepo/apps/gnosi
docker-compose up -d --build
```

- Frontend → `http://localhost:5173`
- Backend API → `http://localhost:5002` (health check at `/api/health`)
- translation-server → internal only

Stop everything with `docker-compose down`.

### Run locally (alternative)

**Backend** (FastAPI / uvicorn):

```bash
cd monorepo/apps/gnosi
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn backend.server:app --host 0.0.0.0 --port 5002 --reload
```

**Frontend** (Vite dev server — proxies `/api` to the backend):

```bash
cd monorepo/apps/gnosi/frontend
npm install
npm run dev
```

Then open `http://localhost:5173`.

## Coding conventions

### Python (backend, pipeline)

- `snake_case` for functions and variables, `PascalCase` for classes.
- Google-style docstrings.
- Import order: standard library → third-party → local.
- Log with `get_logger(__name__)` — never `print()`.
- There is no migration framework; additive columns are handled by an idempotent `ALTER TABLE` pass at startup. Make schema changes additive and idempotent.

### TypeScript / React (frontend)

- `camelCase` for variables, `PascalCase` for components, `UPPER_SNAKE_CASE` for constants.
- ESLint flat config (`frontend/eslint.config.js`). Run `npm run lint` and fix warnings.
- Prefer strict, explicit types — avoid `any`.
- Top-level views go in `frontend/src/pages/`; reusable pieces in `frontend/src/components/`.

### Reusable scripts and tools

Mature, reusable tooling lives under `pipeline/skills/[name]/` with a `SKILL.md` describing it and a `scripts/` subfolder. Experiments and one-offs stay in `pipeline/sandbox/` (gitignored). Secrets come from `.env_shared` (shared) and `.env` (local override) — never hard-code them.

## Testing & QA

A change is not done until it builds and the relevant tests pass. "Couldn't test it" is not a passing state.

**Frontend** — from `frontend/`:

```bash
npm run build   # must complete with zero errors
npm run lint    # fix lint issues before opening a PR
```

**Backend** — run the test suite with pytest (inside Docker is fine):

```bash
cd monorepo/apps/gnosi
pytest            # or: pytest --cov
```

**End-to-end** — Playwright tests live in `e2e/` as a separate host-level project (the frontend container is Alpine/musl, which Playwright browsers don't support). First time:

```bash
cd monorepo/apps/gnosi/e2e
npm install
npx playwright install chromium
```

Then run them against the running app:

```bash
npm test            # full suite
npm run test:smoke  # quick anonymous smoke test
```

For UI changes, verify in a browser before marking the work done — confirm the golden path and obvious edge cases, and watch for regressions elsewhere.

## Commit & pull request process

### Commits

We use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`. Common types are `feat`, `fix`, `docs`, `refactor`, `test`, and `chore`. Keep each commit focused and the summary in the imperative mood.

### Pull requests

1. Branch off `main`. Keep PRs focused and independent — one logical change per PR, not stacked unless necessary.
2. Make sure the build is green and the relevant tests pass (see [Testing & QA](#testing--qa)).
3. Open the PR with a clear description: what changed, why, and how you tested it. Reference any related issue.
4. Don't commit secrets, large binaries, or the local SQLite management database. Never place that database on cloud-synced storage.
5. A maintainer will review. Address feedback with follow-up commits rather than force-pushing over the discussion where possible.

## License

By contributing to Gnosi, you agree that your contributions will be licensed under the **GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later), the same license as the project. See [LICENSE](LICENSE) for the full text.
