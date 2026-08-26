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

The native watchdog must distinguish a hung backend from a slow cold start or
uvicorn reload. A young `--multiprocessing-fork` worker is startup-in-progress
and must not be killed before the configurable startup grace expires. Keep the
restart cooldown at least as long as that grace; shorter windows create a loop
where the worker is terminated before `/api/health` can become available.

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
- Self-hosted Windows release runners must enable Git `core.longpaths` at the
  system level before checkout. Do not rely on global Git configuration because
  `actions/checkout` temporarily overrides `HOME`, which hides user-level settings
  and causes tracked paths longer than the Windows default to fail checkout.
- Keep the Windows runner's local-machine PowerShell policy at `RemoteSigned`.
  A per-step `Bypass` shell only affects workflow `run` steps; JavaScript actions
  such as `actions/setup-python` spawn their own PowerShell process and otherwise
  fail when executing their bundled local setup scripts.
- Add both Git's `cmd` and `bin` directories to the Windows job path. `git.exe`
  lives under `cmd`, while the Electron packaging scripts invoke `bash.exe` from
  `bin`; adding only the former lets checkout pass but fails during packaging.

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

The Docker build workflow runs on the local self-hosted Linux ARM64 virtual
machine. Use its rootless `nerdctl` runtime for image builds, Compose
validation, and the backend health-check container. This keeps Docker-mode CI
independent from the GitHub-hosted Actions budget and does not grant the host a
privileged Docker daemon. The workflow derives `XDG_RUNTIME_DIR` from the
runner user ID so `nerdctl` reaches that user's rootless containerd socket.

The Docker backend is a CPU runtime. Install the pinned CPU-only PyTorch wheel
from the official PyTorch CPU index before the general requirements. Do not let
`sentence-transformers` resolve PyTorch from PyPI on Linux ARM64: current wheels
pull the CUDA/NVIDIA dependency stack, which exhausts the runner disk and adds
several gigabytes that the container cannot use.

 Self-hosted Docker jobs must start the user-scoped `containerd.service` and
`buildkit.service` explicitly: systemd user services may not be active when a
GitHub runner service begins a job. Prune the BuildKit cache with a bounded
timeout before enforcing the 8 GiB free-space guard.

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

## GitHub Actions runner policy

The repository's routine pull-request checks run on the configured self-hosted
Linux ARM64 runner to avoid consuming the hosted Actions budget. This includes
backend tests, documentation, Docker builds, and connector/Vitest tests. When
adding a new workflow or job, do not default to `ubuntu-latest`; use
`[self-hosted, Linux, ARM64]` unless the job genuinely requires a hosted
platform (for example, the macOS Intel, macOS arm64, or Windows release matrix).
Verify the runner labels and required tools before merging the workflow.

The Docker deployment guard also runs on that self-hosted runner. It must use
the preconfigured rootless `nerdctl` service and fail clearly when that runtime
is unavailable. Do not install a privileged Docker daemon, alter AppArmor, or
depend on interactive `sudo` from the workflow.

Release jobs must checkout the workflow run commit (`github.sha`). The tag
entered for a manual release selects the semantic version and destination
release, but it must not make the jobs checkout an older tag that predates
packaging fixes already merged into the workflow commit. For a tag-triggered
run, `github.sha` already resolves to the tagged commit.

The Windows release runner must expose Git before `actions/checkout`. The
workflow should first use Git from `PATH`, then fall back to the standard
`Program Files\\Git\\cmd` installation and add it through `GITHUB_PATH`. Do not
let checkout fall back to the REST ZIP extractor: PowerShell's archive cleanup
can fail on repository dot-directories such as `.agent`, after downloading the
entire archive.

Windows release run steps must invoke their generated scripts with an explicit,
job-scoped `-ExecutionPolicy Bypass`. Do not loosen the machine-wide PowerShell
execution policy: the self-hosted service can inherit a restrictive policy even
when the interactive administrator account does not, and a job-scoped override
is sufficient for the ephemeral Actions scripts.

Linux release packaging is architecture-closed too. The local Linux runner is
ARM64, so PyInstaller produces a native ARM64 backend and electron-builder must
receive `--arm64` explicitly. Do not publish an x64-labelled Electron package
from that runner: it embeds an ARM64 backend that cannot execute on x64 Linux.
