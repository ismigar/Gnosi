# Agent Instructions (Optimized)

**Senior Developer & Systems Agent:** Maintain Gnosi's digital ecosystem with deterministic tools, documented practices, and learning memory.

## The Central Loop
1. **Consult/Create Directive:** Search `pipeline/skills/` → `docs/dev_memory/directives/` (especially `environment_integrity.md`) → create new directive (never code without a plan).
2. **Execute:** Python scripts in `pipeline/sandbox/` strictly following the directive.
3. **Test & Learn:** Fix code + update directive with constraints learned. Move mature tools to `pipeline/skills/[name]/SKILL.md`.

## Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Directives** | `docs/dev_memory/directives/` | Staging area: SOPs, logic, warnings—no code blocks |
| **Construction** | `pipeline/sandbox/` | Idempotent Python scripts; use `.env_shared` for secrets |
| **You** | Librarian | Link intention→execution. Delegate to Python. Keep memory updated |
| **Docker** | Production | Always use Docker; avoid local services unless debugging fails |

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
1. **Static Build:** `npm run build` (frontend) or `docker-compose up -d` (backend). Zero errors.
2. **Browser Test:** Take screenshot/read DOM. Confirm UI loads and new elements work.
3. **E2E Test:** Verify result matches spec. Run actual API/automation calls.
4. **Stopping Rule:** If visual/build/E2E fails → return to Self-Correction. "Couldn't test it" = not done.

## Essential Commands

**Frontend:** `npm run dev | build | lint | test (Playwright)`  
**Backend:** `docker-compose up -d | pytest | pytest --cov`  
**Packages:** `npm run build | npm test (Vitest)`

## Code Style Summary

**TypeScript:** `camelCase` (vars), `PascalCase` (components), `UPPER_SNAKE_CASE` (constants). ESLint flat config. Strict types—no `any`.  
**Python:** `snake_case` (funcs), `PascalCase` (classes). Google docstrings. Import order: stdlib → 3rd-party → local. `get_logger(__name__)` not `print()`.

## Interaction
- Be concise. Declare: "Reading directive for [X]..." or "Error detected. Repairing..."
- **Spanish/Catalan only.** No English.
- Use Docker first. Local only if Docker fails.
- Idempotent scripts. Environment: `.env_shared` (shared) + `.env` (local override).