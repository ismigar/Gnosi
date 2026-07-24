# OneDrive Warmup Daemon

## Objective

Document safe operation of `onedrive_warmup_daemon.py`, which requests macOS
File Provider materialization for online-only files.

## Critical launch-context finding

A background LaunchAgent can serve health and already-local files but may fail
to materialize third-party File Provider placeholders with `EDEADLK`. The same
Python daemon started from a graphical login session can materialize them.

For active hydration, install the daemon as a Login Item through
`sh/install_warmup_loginitem.sh`, not as a background-only LaunchAgent.

The native backend no longer depends on this daemon for normal reads. It is
retained as a recovery tool.

## Components

- `sh/onedrive_warmup_daemon.py`
- `sh/start_warmup_daemon.sh`
- Login Item installer
- Legacy LaunchAgent for health/local-only support

## Permissions and configuration

Grant Full Disk Access to the stable `/usr/bin/python3` binary when required.
Do not wrap it in an ad-hoc-signed application bundle; code changes can
invalidate TCC responsibility and permissions.

Important environment settings:

- Allowed roots: colon-separated absolute directories.
- Bind host and port.
- Bounded materialization timeout.

Requests must be contained within an allowed root.

## Diagnosis

| Result | Meaning | Action |
|---|---|---|
| `materialized` | Success | Continue. |
| `out_of_scope` | Path outside allowed roots | Correct configuration. |
| `errno 1` | Permission denial | Check Full Disk Access and relaunch. |
| `EDEADLK` | Provider cannot hydrate in current state/context | Check graphical launch and OneDrive. |
| `EAGAIN` | Provider temporarily busy | Retry with backoff. |
| `timeout` | Slow download | Wait; a later request may find it local. |

Use symbolic errno names in code because numeric values differ between macOS
and Linux.

If Preview or Finder also cannot open the file, the failure belongs to
OneDrive/File Provider rather than Gnosi.

## Restrictions

- Do not package the helper in an ad-hoc-signed `.app`.
- Do not use `nohup`, tmux, or an always-open Terminal as permanent setup.
- Do not assume a healthy HTTP endpoint proves placeholder hydration works.
- Do not run the helper inside Docker; it must access the host File Provider.
- Do not expose arbitrary host paths.
- Use bounded concurrency to avoid saturating OneDrive.

## QA

1. Health endpoint reports allowed roots.
2. Out-of-scope paths are rejected.
3. A graphical-session instance hydrates a known online-only file.
4. Timeout returns within its configured bound.
5. Native backend continues to function when the helper is unavailable.

See `file_response_warmup_pattern.md` for backend response integration.
