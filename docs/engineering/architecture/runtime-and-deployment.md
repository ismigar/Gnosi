---
status: implemented
last_verified: 2026-08-31
source_paths:
  - scripts/runtime/run_native_dev.sh
  - scripts/runtime/run_native_frontend.sh
  - backend/config/env_config.py
  - backend/config/data_dir.py
  - frontend/vite.config.js
  - docker-compose.yml
  - compose.vaults.yml
  - Dockerfile.backend
  - Dockerfile.frontend
  - desktop/main.js
  - tests/e2e/tests/setup/auth.setup.ts
  - tests/e2e/support/auth-playwright.ts
  - tests/e2e/support/auth-state.ts
tests:
  - pipeline/tests/test_native_runtime_wrappers.py
  - backend/tests/test_env_loading.py
  - backend/tests/test_data_dir.py
  - backend/tests/test_vault_creation_membership.py
  - desktop/application-menu.test.js
  - backend/tests/test_host_helper_url.py
  - tests/e2e/tests/anon/smoke.spec.ts
---

# Runtime and deployment

This page records reviewed source contracts as of the verification date.
Docker is a supported optional deployment target; native development remains
the default. Neither source review nor a configured release target proves
platform acceptance. See the [operations runbook](../operations/runbook.md)
for commands, data preservation and diagnostics.

## Native runtime

Start the two repository wrappers from terminals. macOS LaunchAgents are an
optional host arrangement, not a prerequisite:

| Process | Wrapper under `scripts/runtime/` | Default address | Source reload |
| --- | --- | --- | --- |
| Backend | `run_native_dev.sh 5002` | `127.0.0.1:5002` | uvicorn watches `backend/`. |
| Frontend | `run_native_frontend.sh --config vite.config.js --host 127.0.0.1` | HTTP(S) `127.0.0.1:5173` | Vite reloads source. |

The backend uses `uv run --project "$BASE" --frozen --no-sync` with the
existing root Python environment. Its only environment/data authorities are
Python's `load_env()` and `resolve_data_dir()`, not shell dotenv parsing.
Per-variable precedence is process environment, repository `.env`, then the
shared file explicitly selected with `GNOSI_SHARED_ENV_FILE`; no parent
`.env_shared` is inferred. The data resolver selects `GNOSI_DATA_DIR`, then
`GNOSI_LOCAL_DATA`, then `LOCAL_DATA_DIR`, then the platform default.
The wrapper does not choose a vault when none is configured or force OneDrive,
a provider, `HOME_HOST_PATH`, timezone, model or translation endpoint.

The frontend sets `COREPACK_ENABLE_NETWORK=0` and executes
`corepack pnpm --filter @gnosi/frontend dev`. The example passes Vite's config
and loopback host explicitly; otherwise the configured Vite host applies.
The wrapper preserves explicit `VITE_BACKEND_HOST` and `VITE_BACKEND_PORT`
(defaults: `localhost` and `5002`). Vite owns its dotenv files; the wrapper
leaves an unset `VITE_FRONTEND_PORT` unset so it cannot shadow them. It also
preserves explicit checkout labels and can warn when a served checkout is an
already-merged ancestor of `origin/main`.

Both wrappers validate supplied ports from 1 to 65535, forward arguments and
propagate exits. They do not install or synchronize dependencies; the pinned
package manager and locked environments must already be prepared. Source
reload does not refresh dependencies. `uv.lock` is authoritative, but its
platform-specific dependency choices do not certify the ML stack on every OS
or architecture.

## Docker self-hosting

The base `docker-compose.yml` provides backend, frontend and Zotero's
translation-server without requiring host vault paths or private tooling:

| Storage | Named volume | Backend path |
| --- | --- | --- |
| Per-device state | `gnosi_local_data` (existing key) | `/data`; `GNOSI_DATA_DIR=/data` |
| Vaults | `gnosi_vaults` (new) | `/vaults`; `GNOSI_VAULTS_ROOT=/vaults`, `DIGITAL_BRAIN_VAULT_PATH=/vaults/default` |

Preserve the existing Compose project name and both data volumes on upgrades;
the project name determines named-volume identity. A new vault volume does
not import existing host vaults. Never use `docker compose down -v` or broad
volume pruning to repair dependencies; preserve databases, credentials and
vault content before migration.

Ports publish on loopback by default: `127.0.0.1:5002` and `127.0.0.1:5173`.
`GNOSI_BIND_ADDRESS`, `GNOSI_BACKEND_PORT` and `GNOSI_FRONTEND_PORT` control
host publication. Internal ports remain 5002/5173; the frontend uses HTTP and
proxies API/WebSocket traffic to `backend:5002`. Review access and TLS before
exposing another bind address. A strong private `GNOSI_JWT_SECRET` is required
at Compose interpolation time through the shell or local `.env`; a service
`env_file` alone cannot supply it. `GNOSI_REQUIRE_AUTH=1` is explicit.

Compose optionally reads the shared file selected by `GNOSI_SHARED_ENV_FILE`
(fallback `.env.shared.disabled`), then optional local `.env`. Local entries
win over shared entries; explicit service `environment` wins over both.
Arbitrary host shell values are not automatically container variables.
These files are neither mounted nor baked into images. Compose clears
`GNOSI_SHARED_ENV_FILE` inside the backend after loading their values.

Zotero's translation-server stays internal on 1969. `GNOSI_TRANSLATION_IMAGE`
selects its image; `TRANSLATION_SERVER_URL` defaults to
`http://translation-server:1969` only when unset, preserving an explicit empty
value. Translation is optional to the application; the current Compose file
includes the sidecar without an optional profile.

The explicit `compose.vaults.yml` override requires both existing host paths:
`VAULT_HOST_PATH` for the active vault and `VAULTS_ROOT_HOST_PATH` for its
parent. Both binds use `create_host_path: false`. Merging by container target
replaces the `/vaults` volume, adds `/vault`, sets
`DIGITAL_BRAIN_VAULT_PATH=/vault` and preserves `gnosi_local_data:/data`.
The two host paths are forwarded explicitly for file actions. Relative paths
resolve from the base Compose directory; prefer absolute paths. This override
neither migrates data nor provisions host helpers.

There are no implicit home, private `.antigravity`, secrets-directory, Docker
socket, source-code or host-dependency mounts. Only the explicit override adds
its two vault binds. A Docker CLI inside the backend image does not provide
host-engine access without an explicitly configured socket or endpoint.
Source and dependencies belong to the images: no host-source hot reload or
anonymous `node_modules` volumes. Rebuild after code or lock changes.

The frontend image pins Node 22.22.2 and pnpm 11.19.0, installs with
`--frozen-lockfile` and runs Vite on strict port 5173. The Docker CI job stages
that exact pnpm distribution in the build context before building, so the
image bootstrap does not depend on Docker's access to the npm registry. The
backend exports
`uv.lock` with `--frozen`, installs the pinned CPU-only Torch wheel before
the exported requirements, and runs uvicorn without `--reload`. Wheel
availability and actual build/startup remain platform acceptance requirements.
Static contract tests do not replace actual Compose merging, image builds,
container smoke tests or platform acceptance.

## Electron packages

Electron owns the packaged application lifecycle. It starts the bundled Python
backend, exposes a narrow IPC surface through preload, opens the renderer, and
manages manual update state. The renderer subscribes to updates and can query
the latest state to avoid missing events emitted before React mounts.

The desktop process installs an explicit native application menu instead of
Electron's default development menu. React remains the source of truth for
translated labels: once the configured interface language is resolved, the
renderer sends a validated label set through preload and repeats that handshake
when the language changes. Native Settings commands return to the existing
Global Settings modal. Production menus exclude reload and developer tools.

Gnosi main windows are tracked independently. File → New Window creates another
renderer against the same bundled backend, closing one window removes only that
window, and macOS Dock activation recreates a main window after the last one has
closed. Renderer-bound menu commands focus an existing Gnosi window or wait for
a newly created renderer before delivery.

Candidate jobs produce platform installers plus the update metadata required
by `electron-updater`, after shared CI succeeds at the exact candidate commit.
They retain an Actions artifact for five days, not a GitHub draft or public
release. Publication is disabled pending complete acceptance and a separately
reviewed publication path; see [candidate distribution](../domains/desktop-clients.md).
Configured targets and static
contracts do not prove clean installation, first launch, update, rollback,
signing or data preservation; every platform requires independent evidence.

## Auxiliary host services

Host-open helpers can provide file opening, Spotlight search, native pickers
and Trash actions. Cloud-file helpers can hydrate online-only files; vendor
recovery belongs to the selected adapter. These are optional integrations
requiring explicit provisioning, not portable startup prerequisites.

The 15 historical host-runtime scripts (installers, watchdogs and host tools),
plus the obsolete `run_brain.sh` and `run_prod.sh` launchers, have been retired
from the public repository. Host operations belong in private `WorkspaceTools`.
The historical `install_native_startup.sh` stops listeners on 5002/5173 and
reloads LaunchAgents. A preserved `native_watchdog.sh` can kill broadly matching
multiprocessing workers and restart via launchd; do not execute either script
as a generic diagnostic. Review the actual installed configuration and private
procedures. This checkout cleanup does not change, migrate or uninstall
installed host services. Portable wrappers remain the native startup contract.

## Port and process invariants

- Only one listener may own each selected address/port; 5002/5173 are defaults,
  not permission for native and Docker instances to share a binding.
- Vite uses `strictPort`; silently falling back to another port is a QA failure.
- Native source reload does not update dependencies or startup-injected versions;
  container source changes require rebuilding the image.
- Browser QA follows the active Vite protocol. HTTP applies without readable
  local certificates; automatic HTTPS uses those certificates,
  `VITE_DEV_HTTPS=false` forces HTTP and `VITE_DEV_HTTPS=true` requires them.

## Health and acceptance gates

`/api/health` reports process state, mode, effective authentication policy and
vault configuration. Verify `/api/config` and `/api/vault/pages` with an
authorized session; liveness alone cannot establish vault readability.

Native acceptance must test real registration, workspace and first-vault
creation, login, `/api/auth/me`, HttpOnly cookies and Playwright authentication
setup, with clean startup and shutdown. Browser checks must create/edit a
disposable page, reload/reopen it to verify title/body persistence, inspect
the console and verify logout. Setup requires explicit
`GNOSI_TEST_EMAIL` and `GNOSI_TEST_PASSWORD` for an existing disposable
account, derives identity and workspace membership from the verified session,
and never registers an account or invents admin privileges.
`GNOSI_TEST_WORKSPACE_ID` must match membership; without it exactly one
membership is required. Optional `GNOSI_TEST_VAULT_ID` grants no access.
Keep credentials, cookies and `GNOSI_TEST_STORAGE_STATE` private.

`backend/tests/test_vault_creation_membership.py` covers authorized first-vault
bootstrap, authentication/role/cross-workspace denial, path confinement and
organization listings without registering personal storage. These scoped
checks do not certify the full E2E suite, Docker/Electron matrix or release. The
integration owner performs the remaining real browser, CI, SOP, documentation
generation and platform acceptance checks.
