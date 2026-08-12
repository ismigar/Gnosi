---
status: implemented
last_verified: 2026-08-02
source_paths:
  - backend/server.py
  - backend/config/app_config.py
  - backend/config/env_config.py
  - backend/config/paths_config.py
  - frontend/src/App.jsx
tests:
  - backend/tests/test_app_config_language.py
  - backend/tests/test_host_helper_url.py
  - e2e/tests/anon/smoke.spec.ts
---

# Platform foundation and runtime

## Responsibility

The foundation assembles every domain into one process, resolves portable
configuration and paths, owns startup and shutdown, applies shared middleware,
and exposes the top-level frontend shell. It must remain usable when optional
integrations are absent.

## Backend assembly

`backend/server.py` constructs the FastAPI instance, middleware, exception
handling, static reader mount, lifespan, and routers. Router order is explicit
because workspace context and broad prefixes can overlap. The generated
[API catalog](../generated/api-catalog.md) records every static mount and route.

Lifespan startup performs these classes of work:

1. Assert that an exposed deployment is not using a public development JWT
   secret.
2. Start the scheduler and confirmation-retention maintenance.
3. Reconcile plugin contributions before building agent capabilities.
4. Connect MCP clients, discover tools, and compile the default agent graph.
5. Preload persisted vault indexes synchronously, then refresh them in the
   background where file-provider policy permits.
6. Load derived caches before any save can truncate them.
7. Start per-account IMAP IDLE workers.

Failures in optional AI or integration startup are logged and isolated.
Security and core data initialization failures are not silently converted into
healthy behavior.

## Configuration merge

`load_params()` combines versioned application YAML with the current user or
active-vault configuration. Dictionary values merge recursively. The active
vault's `.gnosi/params.yaml` becomes the persistence target for vault-scoped
settings. Path resolution then applies explicit deployment environment values.

Credential-bearing AI configuration stores references. A legacy environment
credential may create a provider once, but a persisted disconnection tombstone
prevents it from reappearing after deliberate deletion.

## Frontend shell

`App.jsx` waits for authentication bootstrap before selecting the public share,
login, or application shell. Heavy pages are lazy-loaded. The global shell owns
navigation and globally available interaction surfaces; route pages own domain
content. `/s/:token` renders outside the authenticated shell by design.

## Invariants

- Port `5002` is the backend contract; `5173` is the frontend contract.
- Application code uses the authoritative `monorepo/apps/gnosi/` tree.
- Frontend-visible strings use all locale catalogs.
- Runtime imports must not be used by documentation generation.
- An unavailable vault is represented explicitly; a temporary safe path may
  prevent import-time crashes but must not be presented as configured content.
- Derived cache warmup cannot delay the first useful response when a safe disk
  snapshot exists.

## Failure diagnosis

Check process ownership, `/api/health`, `/api/config`, and `/api/vault/pages` in
that order. A successful health response with an empty or failed vault request
indicates configuration or file-provider trouble rather than a dead server.
See the [operations runbook](../operations/runbook.md).
