---
status: implemented
last_verified: 2026-08-24
source_paths:
  - backend/config/env_config.py
  - backend/server.py
  - electron/application-menu.js
  - electron/backend-launch.js
  - electron/main.js
  - electron/preload.js
  - electron/update-policy.js
  - electron/electron-builder.yml
  - electron/package.json
  - electron/release.sh
  - electron/scripts/after-pack.cjs
  - electron/scripts/packaging-contract.cjs
  - electron/scripts/smoke-packaged-backend.py
  - electron/scripts/generate-icons.py
  - electron/build/icon.icns
  - requirements-e2e.txt
  - frontend/public/favicon.svg
  - frontend/package.json
  - frontend/src/content/releases.json
  - web-clipper
  - integrations/libreoffice-cite
  - integrations/word-cite-pin
tests:
  - backend/tests/test_env_config_runtime.py
  - electron/application-menu.test.js
  - electron/backend-launch.test.js
  - electron/packaging-contract.test.js
  - electron/update-policy.test.js
  - integrations/libreoffice-cite/tests
---

# Desktop and companion clients

## Electron desktop

Electron packages Gnosi as a desktop application. The main process owns backend
startup, process cleanup, window lifecycle, packaged-resource paths, update
checks, installer delivery, installation, and privileged desktop actions. The renderer
receives a narrow preload API rather than direct Node.js access.

The bundled Python backend must be ready before the renderer treats the app as
usable. Startup failures are surfaced with diagnostics and cleanup prevents
orphaned backend processes after the window exits.

## Update state machine

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Checking: renderer ready
    Checking --> Available
    Checking --> Current
    Checking --> Error
    Available --> ManualDownload: macOS user opens DMG download
    Available --> Downloading: automatic installation is supported
    ManualDownload --> [*]: browser downloads official DMG
    Downloading --> Ready
    Downloading --> Error
    Ready --> Installing: user confirms restart
```

Checks are disabled in development. Downloads never begin merely because a
release exists. The compact renderer notice does not open the release history,
and version changes do not open that history during application startup. Users
can still open release notes explicitly from the Control Center.
On macOS, current ad-hoc signatures do not provide the stable designated
requirement required by Squirrel.Mac, so the explicit action opens the official
architecture-specific DMG directly. Windows and Linux retain the automatic
download and installation state machine. The main process stores the latest
updater state so a renderer that subscribes late can recover it through IPC.

Seamless macOS restart-and-install must remain disabled until releases use a
stable Apple Developer ID signature and notarization. This policy prevents an
installer that passes standalone `codesign` verification from being offered as
automatically installable when its per-build ad-hoc code-directory hash cannot
match the currently installed application.

Release artifacts include installers and updater metadata for macOS, Windows,
and Linux. Version preparation keeps frontend and Electron manifests aligned;
tags are created only from reviewed `main` commits.

The private release workflow packages macOS Intel and Apple Silicon in separate
matrix jobs. Each job runs on the matching macOS 15 architecture and builds one
native PyInstaller backend before invoking electron-builder for that same
target. This prevents a host-native Python executable from being copied into
the other architecture's application.
The macOS matrix is architecture-closed: each local runner passes exactly one
CLI architecture, and the shared electron-builder macOS targets must not
declare an architecture list. This prevents a host-native frozen Python backend
from being packaged into an Electron application for the opposite architecture.
Manual releases checkout the workflow run commit (`github.sha`); the requested
tag supplies the semantic version and public release destination only. This
keeps packaging fixes merged after version preparation in the binaries without
moving an immutable tag. The Windows job exposes the standard
`Program Files\\Git\\cmd` installation before checkout when the runner service
does not inherit it through `PATH`, preventing the REST ZIP fallback.
Its generated run scripts use a job-scoped PowerShell execution-policy bypass,
so restrictive service defaults cannot reject the ephemeral `.ps1` files
without weakening the VM-wide policy. Release steps must not call
`Set-ExecutionPolicy -Scope LocalMachine`: a more specific Windows policy can
override that setting and make the pre-check fail with
`ExecutionPolicyOverride`, even though the job-scoped bypass is already active.
The Linux release is architecture-closed as well: the local runner and its
PyInstaller backend are ARM64, and electron-builder receives `--arm64`
explicitly. An x64-labelled package must never be emitted from this runner,
because it would contain a backend executable for the opposite architecture.
Release runners are pinned instead of using `macos-latest`, whose migration to
macOS 26 changed DMG creation to APFS
and broke electron-builder's mount-and-customize phase.
Every release job also passes the Python command provisioned by
`actions/setup-python` explicitly to the backend builder. This keeps binary
extensions and their collected OpenSSL libraries on one interpreter ABI instead
of allowing a newer runner-level Python to override the release environment.
The final publication job provisions the same pinned Node.js runtime before
rendering public release notes; self-hosted Linux runners do not guarantee a
global `node` command.
Each backend build creates a uniquely named virtual environment under the host
temporary directory. Packaging attempts never reuse a repository-local virtual
environment, because Windows can retain handles from a terminated PyInstaller
process and reject removal of that directory. Final temporary-environment
cleanup is best-effort; a retained handle cannot block the next invocation.
Because `cryptography` 49 and later no longer publish macOS x86_64 wheels, the
Intel package uses the final compatible universal2 line (`48.0.1`) while other
platforms retain the current dependency floor. The frozen-backend installer
requires a binary `cryptography` distribution; it must fail rather than compile
against a runner OpenSSL that can collide with PyInstaller's collected library.

Electron's builder file list is an explicit runtime boundary. The cross-platform
`afterPack` hook inspects the final `app.asar` and rejects a package that omits
the main process, preload, native-menu, backend-launch, or update-policy module. This installed-
artifact check complements source tests and prevents a valid source tree from
producing an application that fails before its first window opens.

The packaged backend path resolves to the PyInstaller executable itself on
macOS and Linux, and to its `.exe` counterpart on Windows. The main process
spawns that resolved file directly; it never treats the executable as another
directory level. The clean build installs the canonical E2E runtime
requirements, including provider and API dependencies, then starts the frozen
executable as a cross-platform smoke test before the desktop package can
proceed.

The installed desktop process supplies `GNOSI_LOCAL_DATA` under Electron's
per-user application-data directory, unless an explicit override exists. This
keeps native packages away from Docker-only `/app/data`. Readiness polling uses
the unauthenticated `/api/health` endpoint so startup does not wait on a
protected application endpoint. Frozen backends disable Uvicorn's filesystem
reload watcher; native source development retains reload behavior.

The release catalog, localized notes, generated changelog, Electron manifest,
frontend manifest, and monorepo lockfile form one versioned unit. The
deterministic synchronizer updates the three version fields only after the
catalog and changelog validate.

## Application mark

`frontend/public/favicon.svg` defines the Gnosi application mark: a centered
white G with clear blue margin inside a rounded blue gradient. The Electron
icon generator produces the PNG, ICNS, and ICO variants from the same visual
proportions so the browser, macOS, Windows, and Linux clients do not present a
different or edge-to-edge glyph. Regenerate these derived resources whenever
the canonical mark changes; do not edit a packaged application bundle.

## Release preparation

`frontend/src/content/releases.json` is the canonical bundled release history.
The version synchronizer keeps the frontend manifest, Electron manifest, and
frontend workspace entry in the monorepo lockfile identical. A stable entry
prepared before publication deliberately omits `downloadUrl`; that field is
added only after the immutable tag and its platform artifacts exist.
Because the frontend manifest version is a high-impact desktop boundary, every
release-preparation pull request also refreshes this reviewed contract and its
localized mirrors, even when the patch does not change runtime behavior.
Before preparing the next stable patch, the preceding stable entry must already
link to its published release so the bundled history remains complete across
sequential upgrades. Patch notes include only fixes merged after that preceding
tag; they do not repeat already published changes.
Changelog validation normalizes line endings before comparison so an equivalent
Windows CRLF checkout does not fail the cross-platform packaging gate.

Before tagging, the release PR must pass frontend validation, backend tests,
native browser QA, and the engineering-documentation gate. After merge, the
reviewed commit must reach the public repository through the sync workflow and
pass release readiness there. The private source workflow is the sole owner of
official tags, cross-platform artifacts, signed catalogs, release notes, and
the draft in the public repository. The synchronized public desktop workflow is
manual-only so it can validate packaging without racing or duplicating an
official tag build. The resulting macOS, Windows, and Linux artifacts are
inspected before publication.

The v2.0.0 preparation follows this boundary: its localized bundled notes and
generated changelog ship with the synchronized manifests, while the immutable
tag and platform download link are added only after the reviewed main commit
has passed the official release workflow.

The v2.0.1 patch also keeps the frozen backend's canonical runtime requirements
complete and sends official tags through the configured self-hosted runner
matrix. This makes the release workflow validate the same local environments
that produce the platform artifacts.

The v2.0.5 preparation adds a mandatory metadata preflight before platform
packaging. It rejects a tag unless the Electron and frontend manifests, the
monorepo lockfile, the four localized release catalogs, and the generated
changelog all describe the same version.

The v2.0.6 preparation makes the local release deterministic before dispatch.
Every build uses Node 22.22.2 and clean lockfile installs. A reusable preflight
checks version alignment, available disk, idle architecture-specific runners,
and concurrent release runs. Platform jobs are deliberately serialized as
Linux, macOS ARM64, macOS X64, and Windows because the runners share one
physical Mac host; this prevents virtual machines and native packaging from
competing for memory, CPU, and disk. Workflow-level concurrency also prevents
two release attempts from overlapping.

## Web clipper

The browser extension extracts the current page's title, URL, selected or
readable content, and supported metadata, then sends a bounded request to the
Gnosi API. The backend performs authentication, sanitization, deduplication,
and Vault writes. The extension does not receive arbitrary Vault filesystem
access.

## LibreOffice and Word citation clients

The LibreOffice extension registers a protocol handler and calls Gnosi's
citation endpoints from the office process. The Word helper maintains the
task-pane/add-in state required to access the same local service. Both clients
treat citation insertion and bibliography refresh as explicit document
mutations.

Office-specific APIs are isolated behind traversal and insertion helpers so
tests can fake the UNO or add-in boundary without requiring the full office
application for every unit test.

## Invariants

- Renderer code has no unrestricted Node.js or filesystem capability.
- IPC exposes named operations with validated inputs.
- Update download, installer opening, and installation require explicit user actions.
- Packaged resource paths differ from development paths and are resolved at
  runtime.
- Companion clients authenticate to the backend and remain within their narrow
  capture or citation scope.
- Release drafts are inspected before publication.

## Verification focus

Run Electron syntax/build checks, packaged backend smoke tests, updater state
tests, extension build validation, citation traversal tests, and platform CI.
Local macOS packaging cannot prove Windows or Linux artifacts.
