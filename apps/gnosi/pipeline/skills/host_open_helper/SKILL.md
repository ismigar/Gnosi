---
name: host_open_helper
description: Host service that opens local files and directories and searches by name through Spotlight for Gnosi runtimes that cannot access those operating-system capabilities directly.
---

# Host Open Helper

## Purpose

This small HTTP service listens on `127.0.0.1:5099` and opens local paths with
`open` on macOS, `xdg-open` on Linux, or `os.startfile` on Windows. Gnosi uses
it when a user selects a `file://` link in the editor.

It also exposes `/search`, a filename search backed by Spotlight `mdfind` on
macOS. This avoids slow recursive `os.walk` scans over OneDrive.

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

## macOS LaunchAgent installation

Use the portable, idempotent installer. It derives paths from the current
`$HOME` and verifies the result:

```bash
sh pipeline/skills/host_open_helper/scripts/install_launchagent.sh
```

> Do not install the repository's example
> `com.gnosi.host-open-helper.plist` directly. It can contain machine-specific
> paths and is only a reference. On another account, `launchctl` cannot locate
> the script and `file://` links fail. See
> `docs/dev_memory/directives/attachment_link_portability.md`.

Manual installation is acceptable only after verifying every plist path:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.gnosi.host-open-helper.plist
curl -sS http://127.0.0.1:5099/healthz
```

Stop the service with:

```bash
launchctl bootout gui/$(id -u)/com.gnosi.host-open-helper
```

### Reload after code changes

The LaunchAgent runs `host_open_helper.py` by path. Restart it after editing
the script:

```bash
launchctl kickstart -k gui/$(id -u)/com.gnosi.host-open-helper
curl -sS http://127.0.0.1:5099/healthz
```

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

### Empty `/search` results under LaunchAgent

Symptom: `/search` immediately returns `200` and no results, while the same
`mdfind -onlyin $HOME -name <query>` command works in Terminal. Files under
`~/Downloads` or `~/Library/CloudStorage` are commonly affected.

Cause: the LaunchAgent runs under `launchd` and does not inherit Terminal's
Full Disk Access. macOS TCC grants access by binary and responsible process,
so `mdfind` can return filtered results without an error. The same pattern
affects the OneDrive warmup daemon.

Fix: add the LaunchAgent's Python binary to **System Settings > Privacy &
Security > Full Disk Access**. Locate it with:

```bash
ps -p $(pgrep -f host_open_helper.py | head -1) -o command=
```

Then restart the service so TCC reevaluates access:

```bash
launchctl kickstart -k gui/$(id -u)/com.gnosi.host-open-helper
```

As a temporary alternative, boot out the LaunchAgent and run
`host_open_helper.py` manually from a Terminal process that already has Full
Disk Access.
