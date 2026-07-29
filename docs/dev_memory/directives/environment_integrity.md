# Environment Integrity Directive

> **Current architecture (2026-07-15):** Gnosi runs natively by default. The
> backend uses uvicorn on port `5002` and the frontend uses Vite on port `5173`,
> both managed by LaunchAgents. Docker remains a supported self-host deployment
> mode, but it is not a local fallback on this Mac.

## Objective

Keep one deterministic runtime, avoid port conflicts, protect local data, and
ensure every implementation works in both native and Docker deployments.

## Native runtime

- Authoritative code: `monorepo/apps/gnosi/`.
- Backend: repository `.venv`, `backend.server:app`, port `5002`.
- Frontend: Vite HTTPS server, port `5173`, with `strictPort: true`.
- Local data: `monorepo/apps/gnosi/local_data`.
- Logs: `~/Library/Logs/Gnosi/*-native.{log,err}`.
- Main LaunchAgents: `com.gnosi.backend-native` and
  `com.gnosi.frontend-native`.
- Auxiliary agents: `host-open-helper`, `onedrive-warmup`, and
  `native-watchdog`.

Before starting a manual process, check the port and the corresponding
LaunchAgent. Never allow Vite to silently move to port `5174`; a test or
screenshot from that port is a QA failure.

Backend source changes reload automatically because uvicorn runs with
`--reload --reload-dir backend`. Dependency changes require:

```bash
launchctl kickstart -k gui/$UID/com.gnosi.backend-native
```

Frontend dependency changes require `npm install` in `frontend/`; Vite handles
source changes through hot reload.

The native frontend startup script detects a checkout that is both behind
`origin/main` and already an ancestor of it. This means the served branch has
been merged and is stale, not merely that normal feature work is in progress.
Keep the warning visible in development and in the native log. Never
automatically switch, pull, or clean that checkout because it may contain the
maintainer's uncommitted work.

A temporary Git worktree does not contain the ignored `frontend/certs`
directory. Before serving that worktree for browser QA on port `5173`, link the
existing local certificate directory into it. Without the certificates Vite
falls back to HTTP, while the established browser tab remains on HTTPS; that
protocol mismatch invalidates the visual test.

Host prerequisites are installed per machine and do not travel with Git:

- `pandoc` is required for document export.
- `pdflatex` from MacTeX is optional and required only for PDF export.
- System dependencies must be discoverable under the minimal LaunchAgent
  `PATH`. Use the pattern `environment override -> which -> Homebrew paths`.

On the Intel Mac, keep the validated ML dependency caps: torch `2.2.2`,
NumPy `1.26`, transformers `4.44`, and sentence-transformers `3.0`. These caps
do not apply to Apple Silicon. Always inspect the real venv with `pip list`
before changing ML dependencies.

## Dual-mode requirements

Never hard-code Docker-only defaults such as `host.docker.internal`, `/vault`,
or `/app/data`. Native mode would fail silently. Use `_is_docker()` from
`backend/config/env_config.py` and the existing helpers:

- `default_host_helper_url()` for the host helper.
- `_default_warmup_mode()` and `_default_warmup_url()` in
  `files_provider/onedrive.py`.

Environment variables such as `GNOSI_HOST_*_HELPER_URL` and
`ONEDRIVE_WARMUP_*` remain explicit overrides.

Any new system dependency must be supported in both modes: add it to the
Docker image, document the native prerequisite, and resolve it under a minimal
host `PATH`.

Docker recipes live in `docker-compose.yml` and `Dockerfile.*`. CI validates
image builds, `docker compose config`, and an `/api/health` smoke test with
`GNOSI_FILES_PROVIDER=local` on relevant pull requests and weekly.

## Docker-only operational notes

These rules apply only when Docker is deliberately selected for a self-host
deployment.

### Backend source and dependency changes

Inspect mounts before assuming a rebuild is required:

```bash
docker inspect gnosi_backend --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
```

When `backend/` is bind-mounted and uvicorn uses `--reload`, Python source
changes apply automatically. Rebuild after dependency or Dockerfile changes:

```bash
docker compose build backend
docker compose up -d backend
```

Use `--no-cache` only when the dependency layer must be rebuilt cleanly.

### Frontend dependencies and the anonymous volume

The Docker frontend mounts `/app/frontend/node_modules` as an anonymous volume.
For a small dependency change, install in place:

```bash
docker exec gnosi_frontend sh -c "cd /app/frontend && npm install"
```

If internal Vite or dependency files are missing after a lockfile change, the
old anonymous volume is hiding the new image contents. Recreate only the
frontend service and its anonymous volume:

```bash
docker compose rm -fsv frontend
docker compose build --no-cache frontend
docker compose up -d --no-deps frontend
```

Never run `docker compose down -v`; it can remove the named local-data volume.

## OneDrive Files-On-Demand

Native access avoids the Docker/virtiofs `EDEADLK` failure that originally
motivated the migration. Nevertheless, indexing code must remain resilient
because File Provider directories and files can still be unavailable.

### Required read behavior

- Prefer cached index metadata when the response can be built without reopening
  Markdown files.
- Treat a direct file read as a guarded fallback.
- Catch `OSError` per file or directory and continue with a partial result.
- Use `errno.EDEADLK` and `errno.EAGAIN`; never use numeric errno literals
  because their values differ between macOS and Linux.
- Mark partial results with `partial: true` and do not cache them as complete.
- In native mode, request directory hydration with throttled
  `open -g -j <directory>` calls. See `get_markdown_files_efficient` and
  `_request_dir_warmup` in `graph_service.py`.

For citation indexing, `_ensure_cite_key_index` and
`_build_csl_items_for_keys` use metadata from `_page_index_entries`; reopening
the Markdown file is only a guarded fallback.

### Diagnosis and hydration

Check whether a file is online-only:

```bash
ls -lO "<file>" | grep dataless
```

`find ... -flags dataless` is unreliable under CloudStorage. For batch checks,
use `stat -f '%b'`; `st_blocks == 0` indicates an unmaterialized placeholder.
Reading through the warmup daemon is more reliable than `cat`, which may stream
without materializing the file.

The reactive warmup daemon on port `5009` is retained as a recovery tool even
though the native backend does not depend on it for normal reads. Hydrate
`BD/`, `.gnosi/page_meta/`, the active registry, and `.gnosi/params.yaml`
before rebuilding indexes after a synchronization incident. Retry
transient `500` responses sequentially; orphaned placeholders may fail
persistently and should be tolerated.

The durable per-device remedy is OneDrive's “Always keep on this device” for
critical directories. It must be configured separately on every Mac.

## Integration secrets

Per-instance secrets and OAuth tokens belong under
`local_data/secrets/`, never in the Git tree and never in the cloud-synced
vault.

`paths_config.py` exposes this directory through `cfg.paths["SECRETS"]`.
Consumers such as the integration manager, mail metadata manager, and Google
Calendar service must use that path. A legacy secret file may be copied
idempotently only when the destination does not already exist.

Reasons:

- Git cleanup can delete ignored files stored inside the repository.
- OneDrive placeholders can make secrets unavailable.
- A shared organization vault must never expose one user's tokens to other
  members.

Secrets are local per machine. Reconnect Google Calendar or email once on each
machine when credentials are missing.

## Native migration record

The native migration was completed on 2026-06-17:

- Docker Desktop, its images, and the obsolete boot and Docker-watchdog agents
  were removed from this Mac.
- `com.gnosi.onedrive-warmup` was intentionally retained for recovery.
- `com.gnosi.host-open-helper` was retained for Spotlight search, opening
  files with their default app, and moving files to Trash.
- Docker remains a tested deployment option for self-hosting, not a local
  default or fallback.

The original migration gate was:

1. Preserve local data, OAuth secrets, tool registry, and system state.
2. Create the repository venv and install Python dependencies.
3. Run the backend natively and prove `/api/vault/pages` can read online-only
   content without `EDEADLK`.
4. Run the frontend natively on HTTPS port `5173`.
5. Validate databases, dashboards, mail, calendar, search, citations, and
   translations.
6. Decommission Docker only after native QA passed.

## Historical Docker and OneDrive recovery

This section is retained for self-host deployments on old macOS hosts.

Docker Desktop with VirtioFS could deadlock while reading OneDrive File
Provider paths. gRPC FUSE avoided the immediate deadlock, but the Docker VM
could still hang under heavy OneDrive I/O while the GUI process remained
alive. The retired `docker_watchdog.sh` distinguished this state by requiring
both a live Docker process and a failed, time-bounded `docker info` check.

If a Docker host still uses this setup:

- Use timestamped logs: `docker logs -t --since 30s`; un-timestamped uvicorn
  lines make `--since` misleading.
- Test real endpoints such as `/api/health`, `/api/config`, and
  `/api/vault/pages`.
- Restart only the OneDrive app. Do not kill `fileproviderd` or the File
  Provider extension while Docker mounts the vault.
- If recovery is unavoidable, expect Docker and subsequent vault indexing to
  take several minutes.

## Verification gates

1. Exactly one backend listens on `5002` and one frontend on `5173`.
2. `/api/health`, `/api/config`, and `/api/vault/pages` return successful,
   meaningful responses.
3. No new `EDEADLK` or `EAGAIN` exception escapes an index or API request.
4. Native and Docker defaults are selected by runtime detection, with
   environment variables acting only as overrides.
5. Frontend build, relevant backend tests, browser smoke test, and end-to-end
   behavior all pass.
