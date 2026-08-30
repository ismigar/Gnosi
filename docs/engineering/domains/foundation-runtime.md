---
status: implemented
last_verified: 2026-08-28
source_paths:
  - backend/server.py
  - backend/app/lifespan.py
  - backend/config/app_config.py
  - backend/config/env_config.py
  - backend/config/paths_config.py
  - backend/domains/configuration/api/settings.py
  - backend/domains/configuration/plugin_state.py
  - backend/mcp/http_client.py
  - backend/services/data_dir_migration.py
  - backend/utils/cache.py
  - backend/api/system_routes.py
  - frontend/src/app
  - frontend/src/shared
  - frontend/src/generated
  - frontend/feature-public-entries.json
tests:
  - frontend/src/app/composition.contract.test.ts
  - frontend/src/app/shellPages.test.tsx
  - backend/tests/test_app_lifespan.py
  - backend/tests/test_app_config_resolution.py
  - backend/tests/test_app_config_language.py
  - backend/tests/test_config_language_locale.py
  - backend/tests/test_host_helper_url.py
  - backend/tests/test_data_dir_migration.py
  - backend/tests/test_system_filesystem_routes.py
  - tests/e2e/tests/anon/smoke.spec.ts
---

# Platform foundation and runtime

## Responsibility

The foundation assembles every domain into one process, resolves portable
configuration and paths, owns startup and shutdown, applies shared middleware,
and exposes the top-level frontend shell. It must remain usable when optional
integrations are absent.

The frontend `app` directory owns bootstrap, providers, route composition, and
the eager home screen. Optional domain screens enter through public feature
modules with independent lazy imports. Composition contracts preserve all 32
routes, permission wrappers, provider order, and the twenty deferred imports.

## Backend assembly

`backend/server.py` constructs the FastAPI instance, middleware, exception
handling, static reader mount, lifespan, and routers. Router order is explicit
because workspace context and broad prefixes can overlap. The generated
[API catalog](../generated/api-catalog.md) records every static mount and route.
The composition registry imports each canonical domain router directly; legacy
API facades remain available only for compatibility imports. Route annotations
must preserve the frozen OpenAPI representation, so handlers without an
explicit response model retain their inferred response contract.

Lifespan startup performs these classes of work:

The lifecycle module keeps the public `lifespan` context manager as a linear
orchestrator. Focused helpers own plugin reconciliation, agent startup, index
warmup, table repair, mail workers, and bounded shutdown while preserving their
documented order and failure isolation.

Early plugin reconciliation is transport-neutral: it can read normalized,
atomically persisted per-Vault state before any HTTP route module is imported.
This keeps Agent construction independent of Vault facade initialization order,
while normal application startup converges on the same process-wide state store.

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

Shared in-process caches use one bounded, locked TTL/LRU implementation and
accept explicitly typed zero-argument value factories. Streamable MCP HTTP
narrows each decoded SSE payload to a JSON object before returning it to the
JSON-RPC client; malformed or non-object events never enter the typed runtime.

## Configuration merge

`load_params()` combines versioned application YAML with the current user or
active-vault configuration. Dictionary values merge recursively. The active
vault's `.gnosi/params.yaml` becomes the persistence target for vault-scoped
settings. Path resolution then applies explicit deployment environment values.

Credential-bearing AI configuration stores references. A legacy environment
credential may create a provider once, but a persisted disconnection tombstone
prevents it from reappearing after deliberate deletion.

The Settings write boundary validates managed agents and model strategies,
stores passwords and provider keys outside YAML, treats the provider map as
desired state so deletions persist, writes configuration atomically, and
invalidates compiled agents only after an AI change.

Per-device data migration is a journaled state machine. Source verification,
same-volume atomic rename, cross-volume staging, destination verification, and
automatic rollback are separate phases. Every SQLite database is checkpointed
and integrity-checked, and a copied tree is compared against a hashed inventory
before the destination replaces an empty scaffold.

System filesystem routes keep HTTP orchestration separate from bounded browsing
and search helpers. Search prioritizes the active vault and standard user
folders, including the provider-neutral `Library/CloudStorage` root used by
OneDrive, Google Drive, Dropbox, Box and other macOS file providers. Local and
Docker paths are mapped without making any cloud vendor part of the data model.

## Frontend shell

`app/App.tsx` waits for authentication bootstrap before selecting the public share,
login, or application shell. Heavy pages are lazy-loaded. The global shell owns
navigation and globally available interaction surfaces; route pages own domain
content. `/s/:token` renders outside the authenticated shell by design.

## Invariants

- Port `5002` is the backend contract; `5173` is the frontend contract.
- Application code uses the authoritative `Gnosi/` tree.
- Frontend-visible strings use all locale catalogs.
- Runtime imports must not be used by documentation generation.
- Operational one-off commands live under `scripts/`; production packages do
  not contain scratch synchronizers, data-mutating probes, or hard-coded
  machine repair scripts.
- An unavailable vault is represented explicitly; a temporary safe path may
  prevent import-time crashes but must not be presented as configured content.
- Derived cache warmup cannot delay the first useful response when a safe disk
  snapshot exists.

## Failure diagnosis

Check process ownership, `/api/health`, `/api/config`, and `/api/vault/pages` in
that order. A successful health response with an empty or failed vault request
indicates configuration or file-provider trouble rather than a dead server.
See the [operations runbook](../operations/runbook.md).
