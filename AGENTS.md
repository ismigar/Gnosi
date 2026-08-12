# Agent Instructions (Optimized)

**Senior Developer & Systems Agent:** Maintain Gnosi's digital ecosystem with deterministic tools, documented practices, and learning memory.

> ⚠️ **UPDATED ARCHITECTURE (2026-06-17): Gnosi runs NATIVELY, without Docker.**
> The backend (uvicorn `:5002`) and frontend (vite `:5173`) run on the host through LaunchAgents
> `com.gnosi.backend-native` / `com.gnosi.frontend-native` (scripts **in-repo**
> `monorepo/apps/gnosi/sh/run_native_dev.sh` / `run_native_frontend.sh`, virtual environment
> `monorepo/apps/gnosi/.venv`, data in `monorepo/apps/gnosi/local_data`, logs in
> `~/Library/Logs/Gnosi/*-native.{log,err}`; auxiliary agents `host-open-helper`,
> `onedrive-warmup`, `native-watchdog`). uvicorn uses `--reload --reload-dir backend`:
> backend code reloads automatically, but pip changes require
> `launchctl kickstart -k gui/$UID/com.gnosi.backend-native`. This eliminates the OneDrive
> vault `EDEADLK`: files are read natively, like Obsidian. **Docker is NO longer a local
> fallback on this Mac** (Docker Desktop was uninstalled, and images plus the
> `boot`/`docker-watchdog` agents were removed; returning to it requires reinstalling Docker
> Desktop and running `docker compose up -d --build`). **Docker remains a SUPPORTED DEPLOYMENT
> MODE selected by the user** (self-hosted: `docker-compose.yml` + `Dockerfile.*` in
> `monorepo/apps/gnosi/`, checked by `.github/workflows/docker-build.yml` in CI with a build and
> smoke test on every PR and weekly). **The code must work in BOTH modes**: never use
> Docker-only defaults (`host.docker.internal`) or hard-coded native paths; auto-detect through
> `_is_docker()` (`backend/config/env_config.py`; see `default_host_helper_url()` and
> `files_provider/onedrive.py::_default_warmup_mode()`).
> Intel Mac only: torch is capped at 2.2.2, so the virtual environment pins its ML dependencies
> (numpy 1.26 / transformers 4.44 / sentence-transformers 3.0). This does NOT apply to Apple
> Silicon: its virtual environment uses the modern stack (torch 2.12 / numpy 2.4 /
> transformers 5.12). Always verify with `pip list` from the actual virtual environment before
> changing ML dependencies. The full runbook is in
> `docs/dev_memory/directives/environment_integrity.md` (section "PROJECT: migrate Gnosi to
> NATIVE") and memory `gnosi_native_migration_plan`. **Docker references in this file apply to
> the Docker deployment mode (self-hosted), not the default local development mode.**

## The Central Loop
1. **Consult/Create Directive:** Search `pipeline/skills/` → `docs/dev_memory/directives/` (especially `environment_integrity.md`) → create new directive (never code without a plan).
2. **Execute:** Python scripts in `pipeline/sandbox/` strictly following the directive.
3. **Test & Learn:** Fix code + update directive with constraints learned. Move mature tools to `pipeline/skills/[name]/SKILL.md`.

## Repo Structure (CRITICAL — read first)

The Gnosi code lives at **`monorepo/apps/gnosi/...`**. This is the path the dev server reads, `build-release.yml` packages, the public `Gnosi.git` sync (`sync.yml`) exports (and Docker mounts when used). When editing backend, frontend, mail, vault, reader, etc., always use `monorepo/apps/gnosi/...`.

A second `apps/gnosi/...` tree at the repo root used to exist as an obsolete mirror (last synced 2026-04-06 by a workflow that no longer exists); it was removed in `chore: remove apps/ mirror`. If you ever see it reappear, treat it as fossil — only `monorepo/apps/...` is authoritative.

## Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Directives** | `docs/dev_memory/directives/` | Staging area: SOPs, logic, warnings—no code blocks |
| **Construction** | `pipeline/sandbox/` | Idempotent Python scripts; use `.env_shared` for secrets |
| **You** | Librarian | Link intention→execution. Delegate to Python. Keep memory updated |
| **Runtime** | Native (recommended) | Backend `uvicorn` :5002 + frontend `vite` :5173 (LaunchAgents `com.gnosi.backend-native`/`frontend-native`). Docker is **optional** (self-hosted server) |

## Self-Correction Protocol (CRITICAL)

1. **Diagnose:** Why did it fail? (Logic/API/rate-limit/other?)
2. **Patch Code:** Fix in `pipeline/sandbox/`
3. **Patch Directive:** Add section "Restrictions/Edge Cases" with: *"Do not X → causes Y → use Z instead"*
4. **Verify:** Run again
5. **Consolidate:** If robust, move to `pipeline/skills/[name]/`, create `scripts/` subfolder, move directive to `SKILL.md`
6. **Public vs Private:** `skills/` (GitHub, generic) vs `private_skills/` (secrets, infrastructure)

## File Structure
```
Projects/
├── docs/dev_memory/directives/
├── .env_shared (APIs, credentials)
└── monorepo/apps/gnosi/
    ├── backend/ (FastAPI)
    ├── frontend/ (React)
    └── pipeline/
        ├── sandbox/ (testing, .gitignored)
        ├── skills/[skill_name]/
        │   ├── SKILL.md
        │   └── scripts/
        └── utils/ (passive helpers)
```

## QA Protocol (Mandatory)

**Cannot ship without:**
1. **Static Build:** `npm run build` (frontend) or start the backend with `uvicorn` (native). Zero errors.
2. **Browser Test:** Take screenshot/read DOM. Confirm UI loads and new elements work.
3. **E2E Test:** Verify result matches spec. Run actual API/automation calls.
4. **Stopping Rule:** If visual/build/E2E fails → return to Self-Correction. "Couldn't test it" = not done.

## Delivery Protocol (Mandatory for implementation tasks)

After the required validation passes, publish the completed change without waiting for a
separate request: create a `codex/` branch when not already on one, stage only files that
belong to the task, create a focused commit, push the branch, and open or update a draft PR
against `main`. Preserve unrelated worktree changes. Do not create commits or PRs for
analysis-only, diagnostic-only, or explicitly local-only tasks; report authentication,
network, merge-conflict, or approval blockers instead.

### Engineering documentation gate (Mandatory before push/PR)

For every implementation diff that matches the path filters in
`.github/workflows/documentation.yml`, run the repository's documentation gate from
`monorepo/apps/gnosi/` before staging the final commit:

`<python> pipeline/skills/technical_documentation/scripts/pre_pr.py --base-ref origin/main`

Use the active Gnosi virtual-environment interpreter locally (`.venv/bin/python` in the
authoritative workspace) or an equivalent Python environment with `requirements-docs.txt`
installed. The command updates deterministic catalogs, checks functional-change impact,
validates links and localized mirrors, runs documentation-tool tests, and builds all three
strict MkDocs portals. Review and stage every resulting file under
`docs/engineering/generated/`. Run the same command again after staging; do not push or open
the PR unless the second run produces no further generated diff and exits successfully.
Missing documentation dependencies or a stale generated page are blockers, never reasons to
skip the gate. In an isolated worktree, use an available external interpreter rather than
creating or committing a worktree-local virtual environment.

## Essential Commands

**Frontend:** `npm run dev | build | lint | test (Playwright)`  
**Backend:** `uvicorn backend.server:app --reload | pytest | pytest --cov` (optional Docker: `docker-compose up -d`)
**Packages:** `npm run build | npm test (Vitest)`

## Code Style Summary

**Language & i18n (repo is PUBLIC on GitHub — enforce on EVERY change; see `docs/dev_memory/directives/i18n_and_english_standardization.md`):**
- **Code in English:** ALL comments, docstrings, JSDoc **and developer logs** (`console.error/warn/log`, `logger`) in English. Identifiers, stored/compared values, and test data in another language are left as-is. Directive: `english_code_documentation.md`.
- **UI via i18n, never hard-coded:** every user-visible string goes through `react-i18next` — `t('namespace.key', 'default')`, with the key added to **all 4 locales** (`frontend/src/locales/{ca,en,es,fr}/translation.json`). Never leave a `t()` key missing from the locales (it would render the raw default in every language). Directive: `i18n_hardcoded_ui_strings.md`. Exceptions: language endonyms (Español/Català/Français) and persisted/compared data values stay literal. <!-- @language-example -->
**TypeScript:** `camelCase` (vars), `PascalCase` (components), `UPPER_SNAKE_CASE` (constants). ESLint flat config. Strict types—no `any`.  
**Python:** `snake_case` (funcs), `PascalCase` (classes). Google docstrings. Import order: stdlib → 3rd-party → local. `get_logger(__name__)` not `print()`.

## Interaction
- Be concise. Declare: "Reading directive for [X]..." or "Error detected. Repairing..."
- **Conversation with the maintainer: Spanish/Catalan only.** (This is about chat, NOT the code — code documentation is written in English; see Code Style Summary.)
- Native by default (uvicorn + vite through LaunchAgents). Docker is optional (self-hosted server).
- Idempotent scripts. Environment: `.env_shared` (shared) + `.env` (local override).

## GitHub operations
- Always use `git` via SSH remote for fetch, pull, and push.
- Never use the `gh` CLI or check `gh auth status`.
- To create or update pull requests, use the GitHub plugin.
- If the plugin is not available, report the crash without replacing it with `gh`.
