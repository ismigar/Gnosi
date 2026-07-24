# Directive: Portable local-file links

## Problem

A Vault can synchronize across Macs whose account home directories differ.
Absolute `file:///Users/<name>/...` links then break on the other machine.
Opening also depends on the host helper and backend path resolution.

## Runtime layers

1. `host_open_helper` opens files through the host operating system. Install
   its LaunchAgent with the portable installer, never a machine-specific plist.
2. The backend resolves stored paths. When an original path does not exist,
   `_reroot_attachment_under_current_host` maps it to the current host.

Native mode uses host paths directly. Docker deployments can use identity
mounts and `VAULT_HOST_PATH`; resolution must support both through environment
configuration rather than hard-coded paths.

## Read-time rerooting

Try only candidates that exist, in this order:

1. `/api/vault/biblioteca/<relative>` under configured library storage.
2. The path segment below the configured cloud root, covering sibling
   OneDrive directories.
3. A `/Users/<other-user>/...` path with the current host home substituted.
4. A stored `~/...` path expanded through host home, never container `$HOME`.

Apply rerooting to both local-path and resource-opening flows, PDF registration,
path extraction, and safe physical deletion.

Rerooting is a non-destructive runtime fallback. It never rewrites Markdown
and never returns a non-existent candidate.

## Portable write contract

`/link-existing-file` returns a portable URL when possible:

1. File under the shared library →
   `/api/vault/biblioteca/<relative>`.
2. File inside the Vault → `/api/vault/raw/<relative>`.
3. File under host home → `~/<relative>`.
4. File outside host home, such as `/Volumes/...` → no portable URL; preserve
   the inherently machine-local absolute path.

The frontend stores `data.url || data.path`.

Never use `Path.expanduser()` for stored `~/` inside Docker because it expands
to container `/root`. Resolve against `HOME_HOST_PATH` or a host home derived
from configured identity paths.

## Deduplication and names

File fields deduplicate through a canonical target key so equivalent
`file://`, absolute, `~/`, and library API forms identify the same file.

`interpolateNamePattern` must support structured authorship and legacy author
strings, including surname accessors, so renamed files remain stable.

## Cross-record upload safeguard

`InsertContentModal` in table cells is keyed by the selected row ID. Reopening
the modal for another row must remount it. A long upload retains the original
row closure and can never write to the newly selected row.

Do not remove this key during refactors; persistent modal instances are a
known source of cross-record attachment writes.

## OneDrive materialization

Online-only library files can return permanent 503 when the provider knows how
to translate only `/vault` paths. Configure `identity_roots` from library and
host-home paths. A file outside the container Vault but inside an identity
mount passes unchanged to the host materialization service, whose allowlist is
authoritative.

Apply the same mapping to thumbnail path conversion. Log untranslatable paths
at warning level.

Do not depend on OneDrive's "Always keep on this device" pin. Provider database
recreation can lose it. Host-side materialization must work on demand. Reading
an online-only placeholder through a Docker bind mount cannot itself trigger
download.

## Restrictions

- Keep rerooting macOS-specific substitutions guarded so Windows and Linux
  paths are unaffected.
- A `~/...` value is not a browser URL. Display its basename and open it
  through backend resource endpoints.
- Physical deletion needs an explicit `~/` branch and containment after
  rerooting.
- In Docker, test both container Vault and `VAULT_HOST_PATH` when deciding
  whether a picker result belongs to the Vault.
- Keep host-helper and materialization configuration portable between user
  accounts.

## QA

- Current-user and alternate-user OneDrive paths resolve.
- Shared library paths remain supported.
- Truly missing paths return 404.
- Equivalent path forms deduplicate.
- PDF open and safe delete support `~/`.
- Online-only library files materialize through the host service.
- Native and Docker deployment modes use their correct auto-detected paths.
