---
name: host-open-helper
description: Host service that opens local files and directories and searches by name through Spotlight for Gnosi runtimes that cannot access those operating-system capabilities directly.
---

# Host Open Helper

## Purpose

This small HTTP service listens on `127.0.0.1:5099` and opens local paths with
`open` on macOS, `xdg-open` on Linux, or `os.startfile` on Windows. Gnosi uses
it when a user selects a `file://` link in the editor.

It also exposes `/search`, a filename search backed by Spotlight `mdfind` on
macOS. This avoids slow recursive `os.walk` scans over cloud-synchronized folders.

Native Gnosi connects to `127.0.0.1:5099`. Docker deployments use
`host.docker.internal:5099`. The backend selects the correct default through
`default_host_helper_url()` and `_is_docker()`; never hard-code one mode.

## Endpoints

- `GET /healthz`: liveness check.
- `POST /open`: accepts `{"path": "/Users/.../Kitchen"}` or a `file:///...`
  URI. Returns `200` when opened, `403` outside `GNOSI_OPEN_ROOTS`, and `404`
  when the target does not exist.
- `POST /search`: accepts
  `{"query": "...", "limit": 100, "roots": ["/Users/.../Vault", ...]}`.
  It runs `mdfind -onlyin <root> -name <query>`. `roots` is optional and
  defaults to `$HOME`; nested roots are collapsed. The response is
  `{"results": [{"name","path","is_dir"}], "truncated": bool}`.
  Queries shorter than two characters return `400`. A complete Spotlight
  failure returns `500`, allowing the backend to fall back to `os.walk`.

## Security

- Bind only to `127.0.0.1`.
- Restrict paths with colon-separated `GNOSI_OPEN_ROOTS`. When empty, allow
  paths only under `$HOME`.
- Apply the same allowlist to `/search` roots and filter noisy hidden
  directories such as `.git`, `node_modules`, and `.history`.
- Pass the query as a separate argv value and never through a shell.
- Run subprocesses without `shell=True`.

## Provisioning boundary

The public repository ships only the portable helper implementation. It does
not install, start, stop or rewrite operating-system services. Maintainer
LaunchAgent templates and idempotent machine provisioning belong exclusively to
the private `WorkspaceTools/skills/host_open_helper` skill.

Self-hosters may run `host_open_helper.py` directly or create their own service
definition after reviewing every executable path and `GNOSI_OPEN_ROOTS`. Never
copy a service definition from another machine: absolute paths and privacy
permissions are user- and host-specific.

## Restrictions and edge cases

- A Docker container cannot invoke the macOS Finder or Explorer directly. Its
  Linux environment lacks the host `open` executable and GUI session. Use the
  helper through the auto-detected host URL.
- Port `5099` is fixed for predictability. To change it, update
  `GNOSI_HOST_OPEN_PORT` in the plist and the backend URL configuration.
- OneDrive can raise `Errno 35` resource deadlocks on macOS. That affects
  Gnosi indexing, not the helper's open operation.
- `/search` depends on the Spotlight index. It returns an empty result rather
  than an error for volumes excluded from indexing. If `mdfind` fails, the
  helper returns `500` and the backend falls back to `os.walk`.
- `mdfind` diagnostic lines such as `[UserQueryParser] Loading keywords…`
  appear on stderr and do not contaminate stdout results.

### Empty `/search` results under a background service

Symptom: `/search` immediately returns `200` and no results, while the same
`mdfind -onlyin $HOME -name <query>` command works in Terminal. Files under
`~/Downloads` or `~/Library/CloudStorage` are commonly affected.

Cause: a background service does not necessarily inherit Terminal's
Full Disk Access. macOS TCC grants access by binary and responsible process,
so `mdfind` can return filtered results without an error. The same pattern
affects the OneDrive warmup daemon.

Fix on macOS: add the service's Python binary to **System Settings > Privacy &
Security > Full Disk Access**. Locate the configured binary in the private
service definition or process manager.

Then restart it through the owning private provisioning tool so TCC reevaluates
access. As a temporary diagnostic alternative, stop the background service and run
`host_open_helper.py` manually from a Terminal process that already has Full
Disk Access.
