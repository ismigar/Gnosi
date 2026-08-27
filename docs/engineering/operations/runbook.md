---
status: implemented
last_verified: 2026-08-27
source_paths:
  - scripts/runtime/run_native_dev.sh
  - scripts/runtime/run_native_frontend.sh
  - scripts/runtime/native_watchdog.sh
  - docker-compose.yml
  - backend/config/paths_config.py
  - desktop/build-python.sh
tests:
  - tests/e2e/tests/anon/smoke.spec.ts
  - desktop/packaging-contract.test.js
---

# Operations runbook

## Native development baseline

The normal machine runs backend and frontend through LaunchAgents. Before
starting another process, determine which process owns each port and inspect the
native logs. Do not let Vite select a fallback port.

Expected endpoints:

| Service | Address | Meaningful check |
| --- | --- | --- |
| Frontend | `https://localhost:5173` | Application shell renders and can navigate. |
| Backend | `http://127.0.0.1:5002` | `/api/health`, `/api/config`, `/api/vault/pages`. |
| OneDrive recovery helper | `http://127.0.0.1:5009` | Only required for hydration/recovery paths. |

Backend source changes reload automatically. Dependency changes require a
backend LaunchAgent restart. Vite hot reloads source; startup-injected values
such as the application version require a frontend restart.

The native watchdog allows up to ten minutes for a new uvicorn worker to finish
cold startup or source reload before it may restart the backend. This grace
protects scheduler, Vault-index, agent-graph, and ML initialization from a
restart loop. Override `GNOSI_NATIVE_STARTUP_GRACE` only after measuring the
real startup time, and keep `GNOSI_NATIVE_WATCHDOG_COOLDOWN` at least as long.
If the frontend loads but API-backed controls remain unavailable, inspect
`~/.gnosi_native_watchdog.log` for repeated restart entries before changing UI
or Vault state.

## First diagnostic sequence

1. Confirm there is exactly one listener on each application port.
2. Read backend and frontend native error logs.
3. Request `/api/health`; record effective mode and vault status.
4. Request `/api/config`; verify the selected vault without exposing secrets.
5. Request `/api/vault/pages`; distinguish empty content from an I/O error.
6. Reproduce the affected frontend action while watching browser console and
   backend logs.
7. Run the narrowest relevant automated test before restarting broad services.

## OneDrive and cloud-file symptoms

`EDEADLK` or `EAGAIN` on a page/index request indicates a File Provider
availability problem, not a Markdown parser failure. Check file flags and block
materialization. Hydrate the smallest relevant directory through the warmup
mechanism. Retry transient failures sequentially; do not hammer an orphaned
placeholder in parallel.

The backend must continue with partial results where the contract permits.
Never save a partial scan as a complete index. The durable per-device mitigation
is keeping critical directories downloaded locally.

## Local data and secrets

Native state is under `local_data`; Docker state is in the
`gnosi_local_data` volume. Before migration or reinstall, preserve management
SQLite, secrets, tool registry, checkpoints when needed, and system state.

Do not copy live SQLite into a synchronized vault or start two writers against
the same database. Reconnecting OAuth on another machine is expected because
secrets are intentionally per device.

## Docker self-hosting

Docker is used only when deliberately selected. Validate Compose configuration,
build both images, and run the backend health smoke test with a local file
provider. Backend source bind mounts reload Python; dependency or Dockerfile
changes rebuild the backend image.

The frontend uses an anonymous `node_modules` volume. A lockfile change can be
hidden by the old volume; recreate only the frontend service and its anonymous
volume. Never run `docker compose down -v` as a routine repair because it can
remove named local data.

## Common symptom map

| Symptom | Likely boundary | Next evidence |
| --- | --- | --- |
| Frontend white screen | JS runtime, stale chunk, failed auth bootstrap | Browser console, Vite log, production build. |
| Health works, Vault fails | Path config, context, provider hydration | `/api/config`, Vault logs, file availability. |
| Settings revert | Wrong params target, failed atomic write, legacy migration | Active vault context and params source. |
| Integration appears disconnected | Local secret missing or default pointer stale | Masked integration state and local secret directory. |
| Agent has no tools | MCP connection, catalog validation, skill assignment | Startup discovery logs and AI skill endpoints. |
| Mail stops updating | IDLE worker/account error or provider auth | Per-account worker state and incremental sync. |
| Desktop shows old version | Renderer/server not restarted or manifests differ | Frontend and Electron package versions. |

## Documentation operations

Run the generator, validator, and strict MkDocs build from the application root.
Generated differences are reviewed and committed. The portal output under
`site/engineering` is disposable build output and should not be committed.

After a documentation change reaches the public repository's `main` branch,
the Pages workflow publishes the portal at
`https://gnosi.temenosismael.org/engineering/`. If the deployment fails, check
the generated-reference and validator steps before the Pages artifact. Confirm
that repository Pages uses GitHub Actions as its publishing source and that the
`github-pages` environment permits deployments from `main`.

## Desktop release packaging

The Electron packaging script creates a clean temporary Python environment for
each platform build. Keep that environment on pip 25.3 while the self-hosted
Windows runner's network path can rewrite PyPI Simple API responses without a
supported Content-Type. pip 26 rejects that response before dependency
resolution and can incorrectly report that a published package, such as
`python-multipart`, has no available versions. A version change must pass the
Electron packaging contract and a real Windows release job before publication.

## Incident learning

After diagnosing a new failure, fix the implementation, add a regression test,
record the restriction in the relevant directive, and promote stable knowledge
into this portal. An undocumented recovery performed only in a terminal is not
a completed operational fix.
