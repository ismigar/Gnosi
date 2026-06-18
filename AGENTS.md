# Agent Instructions (Optimized)

**Senior Developer & Systems Agent:** Maintain Gnosi's digital ecosystem with deterministic tools, documented practices, and learning memory.

> ⚠️ **ARQUITECTURA ACTUALITZADA (2026-06-17): Gnosi corre NATIU, sense Docker.**
> Backend (uvicorn `:5002`) i frontend (vite `:5173`) s'executen al host via LaunchAgents
> `com.gnosi.backend` / `com.gnosi.frontend` (scripts a `~/.gnosi-local/run-*.sh`, venv
> `~/.gnosi-local/venv`, dades `~/.gnosi-local/data`). Això elimina l'`EDEADLK` del vault
> OneDrive: es llegeix natiu, com Obsidian. **Docker queda com a FALLBACK aturat** (agents
> `boot`/`docker-watchdog` → `.plist.disabled`; restaurar: `docker compose start` + renombrar).
> Gotcha Mac Intel: torch capat a 2.2.2 → deps ML fixades al venv (numpy 1.26 / transformers
> 4.44 / sentence-transformers 3.0). Runbook complet a
> `docs/dev_memory/directives/environment_integrity.md` (secció "PROJECTE: migrar Gnosi a NATIU")
> i memòria `gnosi_native_migration_plan`. **Les mencions a Docker d'aquest fitxer són ara per al fallback.**

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
| **Runtime** | Natiu (recomanat) | Backend `uvicorn` :5002 + frontend `vite` :5173 (LaunchAgents `com.gnosi.backend`/`frontend`). Docker és **opcional** (self-host en servidor) |

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
1. **Static Build:** `npm run build` (frontend) o arrencar el backend amb `uvicorn` (natiu). Zero errors.
2. **Browser Test:** Take screenshot/read DOM. Confirm UI loads and new elements work.
3. **E2E Test:** Verify result matches spec. Run actual API/automation calls.
4. **Stopping Rule:** If visual/build/E2E fails → return to Self-Correction. "Couldn't test it" = not done.

## Essential Commands

**Frontend:** `npm run dev | build | lint | test (Playwright)`  
**Backend:** `uvicorn backend.server:app --reload | pytest | pytest --cov` (Docker opcional: `docker-compose up -d`)  
**Packages:** `npm run build | npm test (Vitest)`

## Code Style Summary

**TypeScript:** `camelCase` (vars), `PascalCase` (components), `UPPER_SNAKE_CASE` (constants). ESLint flat config. Strict types—no `any`.  
**Python:** `snake_case` (funcs), `PascalCase` (classes). Google docstrings. Import order: stdlib → 3rd-party → local. `get_logger(__name__)` not `print()`.

## Interaction
- Be concise. Declare: "Reading directive for [X]..." or "Error detected. Repairing..."
- **Spanish/Catalan only.** No English.
- Natiu per defecte (uvicorn + vite via LaunchAgents). Docker és opcional (self-host en servidor).
- Idempotent scripts. Environment: `.env_shared` (shared) + `.env` (local override).