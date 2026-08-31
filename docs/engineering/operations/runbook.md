---
status: implemented
last_verified: 2026-08-31
source_paths:
  - package.json
  - pyproject.toml
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - uv.lock
  - scripts/runtime/run_native_dev.sh
  - scripts/runtime/run_native_frontend.sh
  - scripts/runtime/install_native_startup.sh
  - scripts/runtime/native_watchdog.sh
  - frontend/vite.config.js
  - backend/app/health_contracts.py
  - backend/config/data_dir.py
  - backend/config/env_config.py
  - backend/config/paths_config.py
  - backend/platform/files/__init__.py
  - backend/platform/files/local.py
  - backend/platform/files/on_demand.py
  - backend/platform/files/onedrive.py
  - scripts/migrate-data-dir.py
  - backend/services/data_dir_migration.py
  - docker-compose.yml
  - Dockerfile.backend
  - Dockerfile.frontend
  - desktop/package.json
  - desktop/backend-launch.js
  - desktop/build-python.sh
  - desktop/electron-builder.yml
  - .github/workflows/build-release.yml
  - .github/workflows/documentation-pages.yml
tests:
  - backend/tests/test_data_dir.py
  - backend/tests/test_env_loading.py
  - backend/tests/test_data_dir_migration.py
  - backend/tests/test_health_api_contract.py
  - backend/tests/test_files_provider.py
  - desktop/backend-launch.test.js
  - desktop/packaging-contract.test.js
  - desktop/packaging-resources.test.js
  - tests/e2e/tests/anon/smoke.spec.ts
---

# Operations runbook

This guide describes contracts reviewed in public source. The verification date
records that review, not a successful installation, migration or release on
every platform. Commands below are operator instructions, not evidence that
they have been executed.

## Native development first

Run the FastAPI backend and Vite frontend natively. Docker, Electron, cloud
storage and macOS LaunchAgents are optional. Use Python 3.11, Node 22.22.2 and
pnpm 11.19.0; the current CI and Docker backend pin uv 0.9.15. From the repository
root, prepare dependencies from the committed locks:

```sh
uv sync --frozen
corepack pnpm install --frozen-lockfile
```

Start the backend and frontend in separate terminals, each at the repository root:

```sh
uv run --frozen uvicorn backend.server:app --host 127.0.0.1 --port 5002 --reload --reload-dir backend
```

```sh
corepack pnpm --filter @gnosi/frontend dev
```

For a local vault, configure its actual directory and select
`GNOSI_FILES_PROVIDER=local`; no download helper is required. Keep the active
vault separate from the parent directory containing multiple vaults.
`DIGITAL_BRAIN_VAULT_PATH` takes precedence over `VAULT_HOST_PATH`; the latter
also informs provider detection. Without an environment override, the backend
can use the vault selected in Settings.

| Service | Default address | Check |
| --- | --- | --- |
| Frontend | `http://localhost:5173` | Sign-in or application shell loads; navigation works. |
| Backend | `http://127.0.0.1:5002` | `/api/health`, then authorized config and vault requests. |

Vite uses `strictPort: true`: resolve a port conflict instead of accepting a
fallback port. HTTPS is optional: automatic mode uses readable local
certificates; `VITE_DEV_HTTPS=false` forces HTTP and `VITE_DEV_HTTPS=true`
requires certificates. Restart Vite after certificate changes. Source changes
reload; dependency changes require synchronizing the locks and restarting the
affected process. Restart the frontend for startup-injected version values.

## Configuration and persistent data

Backend environment loading uses this order for each variable: process
environment, repository-local `.env`, then the shared file explicitly selected
by `GNOSI_SHARED_ENV_FILE`. No parent `.env_shared` is discovered implicitly.
The shared file is operator-owned and read-only to Gnosi's environment cleanup.
Native secure storage can supply missing credentials; it does not replace an
already populated value.

After loading, the data resolver chooses the first nonempty value in this
order: `GNOSI_DATA_DIR`, `GNOSI_LOCAL_DATA`, `LOCAL_DATA_DIR`, platform default.
Both aliases are deprecated but supported throughout 3.x. Configure the
canonical name consistently; a conflicting canonical value wins over an alias
even if the alias came from a higher-priority environment source. Prefer
absolute paths: relative data paths resolve against the process working directory.

| Backend runtime | Default data directory without an override |
| --- | --- |
| macOS | `~/Library/Application Support/Gnosi` |
| Linux | `$XDG_DATA_HOME/gnosi`, otherwise `~/.local/share/gnosi` |
| Windows | `%APPDATA%\Gnosi`, otherwise `~/AppData/Roaming/Gnosi` |
| Docker | `/data`; Compose mounts the named volume `gnosi_local_data` there. |

The old checkout-local `local_data` directory is not the native default.
Vault content and its `.gnosi/` configuration are separate from per-device
state. Keep `GNOSI_DATA_DIR` on local, unsynchronized storage outside the source
tree. Preserve `system/management.sqlite`, `system/tool_registry.sqlite`,
`system/checkpoints`, `secrets` and other required state before reinstalling or
migrating. Do not copy live SQLite files into a synchronized vault or run
independent Gnosi instances against the same data directory. Another device may
need OAuth reconnection because credentials and secure storage are local.

For a deliberate move, inspect `scripts/migrate-data-dir.py`: it exposes
`plan`, `migrate`, `status`, `rollback` and `finalize`. Planning may create
the destination parent, so it is not a purely read-only diagnostic. Stop all
writers before migration or rollback; `--writers-stopped` is an operator
confirmation, not a process detector. The service journals progress, checks
SQLite integrity and checkpoints WAL. It uses a same-volume rename or a verified
staging copy across volumes, preserving the source in the copy case. Retain the
journal and backup, verify the destination, then configure `GNOSI_DATA_DIR`
before restarting. Merely changing the variable does not move existing data.

## First diagnostic sequence

1. Identify the selected runtime, checkout, process owner and listener on each
   application port before starting or restarting anything.
2. Inspect that runtime's backend/frontend logs; do not assume LaunchAgent paths.
3. Read `/api/health`: `status`, `mode`, `gnosi_mode`, `require_auth` and
   `vault_configured`. A liveness response does not prove vault readability.
4. Use an authorized session for `/api/config` and `/api/vault/pages`.
   Distinguish authentication or permission failures from an empty vault or I/O
   failure; redact credentials and private paths before sharing diagnostics.
5. Confirm the active vault, effective data directory and selected provider.
   Do not reset settings or replace databases to repair a wrong path.
6. Reproduce the affected UI action while checking browser console and backend
   logs, then run the narrowest relevant test.
7. After a targeted repair, verify both the returned data and the visible action;
   a process restart alone is not recovery evidence.

## File availability and provider-specific recovery

Start with the selected adapter in `backend/platform/files`.
`GNOSI_FILES_PROVIDER` selects a known provider explicitly; otherwise detection
uses `VAULT_HOST_PATH`. `LocalProvider` performs no hydration. A provider name
or shared interface does not certify every cloud client's behavior on every OS.

On macOS File Provider storage, `EDEADLK` or `EAGAIN` can indicate unavailable
online-only files. These errors alone do not prove a provider fault or a
Markdown parser fault: check the exact path, file flags, downloaded blocks and
client state. Retry the smallest affected scope with bounded, sequential
attempts; do not turn a partial recovery scan into a complete index or replace
unreadable content with empty files. Keeping critical directories downloaded
locally can prevent recurrence.

The current on-demand adapter defaults to `open` on native macOS, delegating
reads to a GUI application through LaunchServices; direct reads from a launchd
process may fail to trigger downloads. Daemon mode instead calls a configured
host helper, defaulting to `http://127.0.0.1:5009/warmup` natively or
`http://host.docker.internal:5009/warmup` from Docker. That helper must actually
be provisioned for the selected setup; port 5009 is not a general startup
requirement or proof that arbitrary cloud hydration works.

Only the OneDrive adapter opts into restarting the OneDrive client after a
failed `open` attempt. `ONEDRIVE_AUTO_RESTART=0` disables that action; its
default cooldown is 300 seconds. Treat client restarts and host helper
provisioning as separate operational changes. Do not apply OneDrive recovery
instructions to other providers.

## Optional macOS host provisioning

`scripts/runtime/install_native_startup.sh` installs LaunchAgents that call
the native wrapper scripts. Existing installations may write logs under
`~/Library/Logs/Gnosi`; inspect their actual configuration. These are optional
host conveniences, not the portable startup contract. Machine-specific service
definitions, private paths and incident history belong in private
`WorkspaceTools`, not in public prerequisites.

Inspect `scripts/runtime/run_native_dev.sh` before adopting it: it still has
a maintainer-specific OneDrive vault fallback and forces
`ONEDRIVE_WARMUP_MODE=open`, `TZ=Europe/Madrid` and an empty
`TRANSLATION_SERVER_URL`. Its data fallback handles `GNOSI_LOCAL_DATA`, but
does not consult `LOCAL_DATA_DIR` before assigning `GNOSI_DATA_DIR`.
Use the explicit native commands above for the portable baseline.

For an installation that already uses `scripts/runtime/native_watchdog.sh`,
inspect `~/.gnosi_native_watchdog.log` for restart loops. Startup grace
(`GNOSI_NATIVE_STARTUP_GRACE`) and restart cooldown
(`GNOSI_NATIVE_WATCHDOG_COOLDOWN`) both default to 600 seconds; retain adequate
time for cold startup or reload and keep cooldown at least as long as the
measured startup requirement. A fresh clone heartbeat can defer a restart.
The script also kills matching multiprocessing workers and invokes launchd:
its process matching is broad, so do not run it as a generic diagnostic or
install it without reviewing the host's other Python workloads.

## Optional Docker deployment

The current Compose file is a development-oriented bundle, not a minimal
isolated deployment. Configure `VAULT_HOST_PATH` and
`VAULTS_ROOT_HOST_PATH` explicitly; its fallback paths still name the
maintainer's OneDrive layout. Review mounts before use: they include the Docker
socket, the home directory, a private `.antigravity` directory, legacy secrets
and source code. Their presence does not make private host tooling a Gnosi
requirement. Review published ports and authentication before exposing a host.

Supply a strong private `GNOSI_JWT_SECRET` to Compose interpolation through the
shell or local `.env`; a service `env_file` alone does not satisfy its required
interpolation expression. Compose sets `GNOSI_DATA_DIR=/data`, mounts
`gnosi_local_data` there and uses `/vault` and `/vaults` for vault mounts.
The optional bundle also includes Zotero's translation-server.

`Dockerfile.frontend` installs from `pnpm-lock.yaml` with
`--frozen-lockfile`. Compose currently masks both `/app/node_modules` and
`/app/frontend/node_modules` with anonymous volumes. After dependency changes,
rebuild the frontend image and renew only that service's dependency volumes;
otherwise old contents can hide the new lock. The backend exports `uv.lock`
with `--frozen`, then installs runtime requirements after a CPU-only Torch
wheel. This special wheel step still needs platform validation. Backend source
reloads through its bind mount; dependency changes require an image rebuild.
Never use `docker compose down -v` or broad volume pruning as routine repair:
the named volume contains persistent databases and credentials.

## Optional Electron packaging

Electron uses inherited `GNOSI_DATA_DIR`, then `GNOSI_LOCAL_DATA`, then
`LOCAL_DATA_DIR`; otherwise it passes its `userData` profile to the bundled
backend. Do not assume this profile is identical to the native Python default
on every OS. Preserve the profile as well as any separately configured backend
data before an update.

The workspace pins Electron and disables its automatic binary download.
`corepack pnpm --filter @gnosi/desktop install:runtime` is the explicit binary
installation step when running Electron locally. Build the frontend before
packaging. `desktop/build-python.sh` requires Python 3.11 and uv, creates a
temporary environment and uses `uv sync --frozen --no-default-groups --group desktop`
against the repository lock. It checks resource boundaries, runs PyInstaller,
verifies the bundle and runs the packaged-backend smoke test. There is no
current pip 25.3 pin; diagnose proxy or package-index errors on the affected
runner instead of reviving that historical workaround.

| Target declared by the release workflow | Configured artifacts |
| --- | --- |
| macOS arm64 | DMG and ZIP |
| macOS x64 | DMG and ZIP |
| Linux arm64 | AppImage and DEB |
| Windows x64 | NSIS installer |

These are configured targets, not acceptance results. The frozen Python backend
must match the Electron target architecture. Linux x64 and Windows arm64 are
not covered by the current release jobs. Static contracts or a frontend build
do not establish clean installation, first launch, update, rollback, signing or
real data preservation on any target. Require actual platform evidence before
publishing; Docker validation is a separate check.

## Common symptom map

| Symptom | Likely area | Next evidence |
| --- | --- | --- |
| Blank frontend | JavaScript error, stale chunk, auth bootstrap | Browser console, Vite log, production build. |
| Health responds, vault fails | Vault path, permissions, file availability | Authorized config, vault logs, exact failing path. |
| Settings revert | Wrong params target, failed write, migration | Active vault context and params source. |
| Integration appears disconnected | Local credential missing or stale account selection | Masked account state and configured secret storage. |
| Agent has no tools | MCP connection, catalog validation, skill assignment | Discovery logs and authorized skill endpoints. |
| Mail stops updating | Account worker or provider authentication | Per-account worker state and incremental sync. |
| Desktop shows an old version | Stale renderer/backend or mismatched manifests | Actual running checkout/bundle and package versions. |

## Documentation and incident learning

Use the documentation pre-PR workflow in
[Documentation maintenance](../testing/documentation-maintenance.md).
Review all four languages manually; refresh only generated catalogs
deterministically. The integration owner runs pre-PR checks, strict builds for
all four portals and browser QA after workers finish. Keep `site/engineering`
and its locale subdirectories out of source control.

The Pages workflow is configured to publish documentation changes on `main`
to [the engineering portal](https://gnosi.temenosismael.org/engineering/).
On failure, inspect generated-reference validation, traceability and strict
locale builds before the Pages artifact. Check the repository's actual Pages
source and `github-pages` environment permissions; workflow source alone does
not prove deployment succeeded.

Record incident causes, failed attempts and verified recovery. Keep private
machine details and development directives in `WorkspaceTools`; publish only
portable lessons with source and test evidence. Fix implementation and add
focused regression coverage when warranted. A terminal-only recovery without
verification or documentation does not complete an operational repair.
