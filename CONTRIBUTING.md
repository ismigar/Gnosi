# Contributing to Gnosi

Thanks for your interest in improving Gnosi! This guide covers how to get a development environment running, the conventions we follow, and how to get a change merged.

Gnosi is **free software under the AGPL-3.0-or-later**. By contributing, you agree that your contributions are licensed under the same terms (see [License](#license)).

## Ways to contribute

- **Report bugs** — open an issue with steps to reproduce, what you expected, and what happened. Include your OS, whether you run via Docker or locally, and the relevant logs.
- **Propose features** — open an issue describing the problem you're trying to solve before writing code. Gnosi is local-first and privacy-respecting; features that phone home or assume a central server are usually out of scope.
- **Improve docs** — fixes to the README, [ARCHITECTURE.md](ARCHITECTURE.md),
  [engineering portal](docs/engineering/index.md), or this guide are very welcome.
- **Send a pull request** — see [Commit & pull request process](#commit--pull-request-process) below.

## Repository layout

Gnosi is the repository root. The release workflow and desktop build consume this tree directly.

```
Gnosi/
├── backend/      # FastAPI app: api/ (routes), services/ (logic), models/, agent/, scheduler/
├── frontend/     # React + Vite SPA (BlockNote editor, Sigma.js graph)
├── pipeline/     # Python "skills" — analysis, integrations, idempotent scripts
├── desktop/      # Electron desktop wrapper and distribution assets
├── extensions/   # Connectors, office add-ins, web clipper and examples
├── scripts/      # Operational scripts
└── tests/e2e/    # Consolidated Playwright end-to-end tests
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together and where to add new things.

The detailed [engineering portal](docs/engineering/index.md) connects product
domains to source, API operations, relational models, configuration, and tests.
When a change alters one of those contracts, update the reviewed guide and run:

```bash
uv run python pipeline/skills/technical_documentation/scripts/generate.py
uv run python pipeline/skills/technical_documentation/scripts/generate.py --check
uv run python pipeline/skills/technical_documentation/scripts/validate.py
pnpm docs:build
```

## Development setup

### Prerequisites

- **Python 3.11** and **uv**
- **Node.js 22.22.2** and **pnpm 11.19.0**
- **(Optional) Docker** — an all-in-one alternative that bundles backend, frontend, and the Zotero translation-server.

### First-time setup (fresh clone)

Build the bundled PDF/EPUB reader once (the build artifacts are not committed):

```bash
git submodule update --init --recursive
scripts/runtime/build-zotero-reader.sh
```

Without this step, documents in the vault return 404 in the reader. Re-run it whenever you update the submodule.

### Run natively (recommended)

**Backend** (FastAPI / uvicorn):

```bash
uv sync --frozen
pnpm install --frozen-lockfile
pnpm dev:backend
```

**Frontend** (Vite dev server — proxies `/api` to the backend):

```bash
pnpm dev:frontend
```

Then open `http://localhost:5173`.

### Run with Docker (optional)

First set `GNOSI_JWT_SECRET` in the process or an untracked local `.env`.
The bundle uses named data/vault volumes and requires authentication; see the
[Docker quick start](README.md#run-with-docker-optional) for existing host vaults.

```bash
pnpm docker:up
```

- Frontend → `http://localhost:5173`
- Backend API → `http://localhost:5002` (health check at `/api/health`)
- translation-server → internal only

Stop everything with `pnpm docker:down`.

## Coding conventions

### Language

**Write all code in English** — comments, docstrings, JSDoc, and developer logs
(`console.*`, `logger`). Gnosi is an open project and English is the shared language of the
codebase, so anyone who clones the repository can read it. **User-facing text, in contrast, is
never hard-coded**: every visible string goes through the i18n system (`react-i18next` —
`t('namespace.key', 'default')`) with the key added to all four locales
(`frontend/src/locales/{ca,en,es,fr}/translation.json`). Identifiers, stored/compared values,
test data, and language endonyms (Español/Català/Français) that happen to be in another <!-- @language-example -->
language are left as-is. In short: **code and logs in English; product content through i18n.**
See `docs/dev_memory/directives/i18n_and_english_standardization.md`.

### Python (backend, pipeline)

- `snake_case` for functions and variables, `PascalCase` for classes.
- Google-style docstrings.
- Import order: standard library → third-party → local.
- Log with `get_logger(__name__)` — never `print()`.
- There is no migration framework; additive columns are handled by an idempotent `ALTER TABLE` pass at startup. Make schema changes additive and idempotent.

### TypeScript / React (frontend)

- `camelCase` for variables, `PascalCase` for components, `UPPER_SNAKE_CASE` for constants.
- ESLint flat config (`frontend/eslint.config.js`). Run `pnpm lint:frontend` and fix warnings.
- Prefer strict, explicit types — avoid `any`.
- Top-level views go in `frontend/src/pages/`; reusable pieces in `frontend/src/components/`.
- Treat `openapi/openapi.json` as a generated backend contract and
  `frontend/src/generated/openapi.ts` as generated code. Never edit either by hand.
- Use `frontend/src/shared/api/` for HTTP, query caching, streaming, downloads,
  SSE and WebSockets. Production components must not import Axios or call the
  browser's `fetch` directly. The reviewed exception list lives in
  `frontend/api-boundaries.json`.
- Run `pnpm check:api-client` after changing a public route, schema or frontend
  network boundary. Regenerate intentional contract changes with
  `pnpm generate:api-client`, then review both generated diffs.

### Reusable scripts and tools

Mature, reusable tooling lives under `pipeline/skills/[name]/` with a `SKILL.md` describing it and a `scripts/` subfolder. Experiments and one-offs stay in `pipeline/sandbox/` (gitignored). UI-managed secrets use the system credential store. Process variables take precedence over Gnosi's local `.env`; an optional shared file is read only when `GNOSI_SHARED_ENV_FILE` explicitly names it. Never hard-code credentials.

## Testing & QA

A change is not done until it builds and the relevant tests pass. "Couldn't test it" is not a passing state.

**Frontend** — from the repository root:

```bash
pnpm check:api-client
pnpm --filter @gnosi/frontend typecheck
pnpm test:frontend
pnpm build:frontend
pnpm lint:frontend
```

**Backend** — run the test suite with pytest (with your venv active):

```bash
uv run pytest
```

**End-to-end** — Playwright tests live in `tests/e2e/`. First time:

```bash
pnpm test:e2e:install
```

Then run them against the running app:

```bash
pnpm test:e2e
pnpm test:e2e:smoke
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
