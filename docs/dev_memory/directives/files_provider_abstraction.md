# FilesProvider Abstraction

**Last updated:** 2026-05-10
**Status:** active, phase 3
**Module:** `monorepo/apps/gnosi/backend/services/files_provider/`

## Problem

Cloud storage providers use different placeholder and hydration mechanisms.
Product code must not assume that every vault uses OneDrive, macOS
`st_blocks == 0`, or the OneDrive warmup daemon.

## Objective

Isolate online-only detection and materialization behind one stable interface.

```python
class FilesProvider(ABC):
    name: str

    @abstractmethod
    def is_online_only(self, path: Path) -> bool:
        """Return whether a logical file is not materialized locally."""

    @abstractmethod
    async def materialize(self, path: Path) -> bool:
        """Request local materialization and report whether it succeeded."""
```

Use an abstract base class rather than a runtime `Protocol` so incomplete
implementations fail immediately.

## Providers

- `LocalProvider`: always local; materialization is a successful no-op.
- `OneDriveProvider`: macOS File Provider detection and host warmup.
- `iCloudDriveProvider`: same File Provider behavior, with `ICLOUD_*`
  environment variables and fallback to `ONEDRIVE_*`.
- `GoogleDriveProvider`: modern Google Drive for Desktop on macOS uses the same
  File Provider behavior, with `GDRIVE_*` variables.
- `NextCloudProvider`: experimental. Detects
  `user.nextcloud.is-virtual-file` or `.nc-virt` placeholders and delegates
  materialization to a configured daemon.

Legacy Google Drive FUSE mounts and Windows Cloud Filter API are not covered.

## Provider selection

`get_files_provider()` is a thread-safe singleton. Selection order:

1. Explicit `GNOSI_FILES_PROVIDER`: `local`, `onedrive`, `icloud`, `gdrive`,
   or `nextcloud`.
2. Path heuristic:
   - `OneDrive` -> `onedrive`
   - `GoogleDrive` or `Google Drive` -> `gdrive`
   - `Mobile Documents` or `iCloud` -> `icloud`
   - `nextcloud` -> `nextcloud`
3. Otherwise -> `local`.

The explicit environment value always wins. Unknown values log a warning and
fall back to detection. Heuristics preserve backward compatibility only; they
are not a substitute for explicit deployment configuration.

## Policy

1. Product code never checks `st_blocks` or calls a provider-specific warmup
   helper directly.
2. All detection and materialization use `get_files_provider()`.
3. Existing OneDrive environment variables retain their names.
4. Provider-specific variables fall back to compatible OneDrive settings only
   where behavior is actually shared.
5. Filesystem `EDEADLK` handling remains a cross-provider I/O concern, not part
   of provider selection.
6. Native mode and Docker mode must both work; materialization defaults use
   runtime detection rather than Docker-only hostnames.

## Refactoring boundary

`serve_vault_image` and `_serve_file_with_containment` in `vault_routes.py`
must call:

```python
provider = get_files_provider()
if provider.is_online_only(path):
    await provider.materialize(path)
```

Provider state such as the semaphore, in-flight cache, timeout, URL, and path
translation belongs inside the provider implementation.

## Blocking I/O deadline lesson

The original warmup daemon checked elapsed time between blocking reads. A
kernel-blocked `read()` never returned to the check, so a configured timeout
could still hang for minutes.

The corrected implementation performs the read on a daemon thread and uses
`join(timeout)`. A timed-out thread may finish in the background, and a later
request can observe the hydrated file.

General rule: a cooperative deadline between iterations cannot interrupt a
blocking I/O call. Use an interruptible mechanism such as a worker thread with
a bounded join, a suitable signal, or non-blocking I/O.

## NextCloud restrictions

- Extended attributes may not cross a Docker bind mount, so extension
  detection remains a fallback.
- Actual materialization behavior varies by NextCloud client version.
- If `open()` does not trigger download, configure
  `NEXTCLOUD_WARMUP_URL` for a dedicated helper.
- This provider remains experimental until validated on a real installation.

## QA gates

1. Unit tests cover explicit overrides, heuristic selection, precedence,
   unknown values, provider-specific variables, and placeholder detection.
2. Backend static checks and relevant tests pass.
3. A real online-only file materializes within the configured timeout.
4. A materialized file does not trigger another warmup request.
5. Vault and library images render without `503` regressions.
6. Logs identify the selected provider in English.
