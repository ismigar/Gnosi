# Gnosi Desktop

Electron wraps the React frontend and a bundled FastAPI backend. The canonical
source is this repository; commands below run from its root, not from
`desktop/`. Native browser development remains available without Electron.

## Toolchain

Use Node **22.22.2**, pnpm **11.19.0**, Python **3.11** and uv. The desktop pins
Electron **43.4.1**, electron-builder **26.15.3** and ASAR **4.3.0**.
Electron's embedded Node is separate from the workspace Node used for builds.
Windows packaging also requires Bash (for example from Git for Windows) on
the build process PATH, because the Python bundle script is a shell script.

```bash
pnpm install --frozen-lockfile
uv sync --frozen
pnpm --filter @gnosi/desktop install:runtime
```

The explicit last command installs the pinned Electron binary. Do not enable
all dependency install scripts to repair a missing binary. Normal Electron CLI
startup can also download a missing runtime; the isolated smoke launchers
instead stop with installation guidance. These setup commands may download
dependencies, but do not constitute platform acceptance.

## Development: choose one backend owner

For native browser development, `pnpm dev` starts both FastAPI on 5002 and Vite
on 5173. Electron development is different: it starts its own FastAPI child and
expects Vite to be running independently.

For Electron development on macOS/Linux, use two terminals after setup:

```bash
# Terminal 1: the HTTP origin accepted by Electron's development sender guard
VITE_DEV_HTTPS=false pnpm dev:frontend
```

```bash
# Terminal 2: supply the synchronized Python environment to the Electron child
uv run --frozen --no-sync pnpm desktop:dev
```

In PowerShell, set `$env:VITE_DEV_HTTPS = 'false'` before `pnpm dev:frontend`
instead of using the POSIX environment prefix. The second command is unchanged.

Do not also run `pnpm dev` or `pnpm dev:backend`: Electron does not adopt an
existing backend on 5002. Its development uvicorn child does not use reload.
Vite must serve `http://localhost:5173`; an HTTPS Word add-in session is a
different configuration and is not accepted as that trusted desktop origin.

Normal desktop startup uses the real existing profile. Close older Gnosi
instances and retain verified backups before an upgrade. Use the isolated
smoke commands below for synthetic QA, not the production entry point.

## Build local artifacts

Build the renderer first, then package on the actual target platform:

```bash
pnpm build:frontend
pnpm package:desktop
```

The frontend's default asset base is `/`, shared with web hosting. The standard
`app://gnosi` protocol serves those root-relative assets and returns the SPA
entry for nested application routes. Do not set `VITE_BASE_PATH=./` for desktop:
that makes reloads resolve assets relative to the current route. Custom asset
prefixes are not router basenames. The config and protocol regression tests do
not replace actual platform installation and upgrade validation.

For explicit platform builds, use one matching command:

```bash
pnpm --filter @gnosi/desktop build:mac
pnpm --filter @gnosi/desktop build:linux
pnpm --filter @gnosi/desktop build:win
```

These commands each build Python once, then invoke electron-builder with
`--publish never`. The root `build:desktop` alias uses the same nonpublishing
generic build. They do not create a tag, upload a release or prove an update.

`desktop/build-python.sh` requires Python 3.11 exactly, selected through
`GNOSI_PYTHON_CMD` or `python3.11`. It consumes the frozen `uv.lock` and the
`desktop` dependency group in a unique temporary environment, validates
PyInstaller resources and the result, then runs the isolated packaged-backend
smoke. Do not install a second requirements tree or substitute global PyInstaller.

Generated outputs are `desktop/python-build/`, `desktop/dist-python/`
and `desktop/dist/`. Packaging replaces regenerable build outputs; keep
user data and recovery archives outside those paths.

| Configured target | Required host architecture | Artifacts |
| --- | --- | --- |
| macOS arm64 | macOS ARM64 | `Gnosi-<version>-arm64.dmg` and ZIP |
| macOS x64 | macOS X64 | `Gnosi-<version>-x64.dmg` and ZIP |
| Linux arm64 | Linux ARM64 | `Gnosi-<version>-arm64.AppImage` and DEB |
| Windows x64 | Windows X64 | `Gnosi-<version>-Setup.exe` |

Use a native backend for each target; a cross-architecture Electron shell does
not make the frozen Python executable portable. The workflow also preserves
blockmaps and `latest-mac.yml`, `latest-linux-arm64.yml` or `latest.yml`.
Configured targets are not evidence of successful installation or upgrade.

## Release preparation is not publication

`desktop/release.sh <version>` updates root/frontend/desktop/Python versions,
refreshes locks, builds the frontend and packages the current platform. It does
not create a version tag or a GitHub draft. Use it only on an explicit release
preparation branch with the corresponding catalog/notes reviewed; the version
synchronizer itself does not validate catalog content or make an atomic transaction.
It reads and prepares all four inputs before writing: an unreadable input or
unsupported version field leaves every file unchanged. Only the top-level JSON
version and the single-line quoted `[project].version` are replaced; nested
versions, comments and line endings are preserved. An identical version is a
no-op. Ambiguous duplicate fields are rejected. The TOML locator is not a full
TOML validator; lock refresh still validates the Python project. An I/O failure
or interruption during separate writes can leave partial changes. Review and
recover from the preparation branch's recorded baseline before retrying, and
review all changed manifests and locks before integration.

`release-version.js` is the shared release-version boundary for updater policy
and artifact validation. It uses the SemVer implementation locked with
`electron-updater`, accepts canonical build metadata, and rejects surrounding
whitespace, `v` prefixes and invalid or non-canonical versions. Do not add a
second parser in packaging or update code.

The current **Build Release Candidate** workflow checks tag/commit identity,
runs the shared CI and then builds the four target groups. Its collector verifies
versions, manifest references and SHA-512 hashes before combining macOS update
metadata and generating indexes and notes. The final Actions artifact is named
`candidate-<tag>-<sha>-<attempt>` and retained for five days.

The workflow has read-only repository permissions. It does not publish or modify
GitHub releases or public updater channels. Candidate artifacts must not contain
credentials or user data and are not confidential storage.

Public distribution remains disabled until the complete native, Docker,
installer and real 2.x upgrade matrix is accepted and a separate publication
path is reviewed. A green build or a candidate artifact is not permission to
publish Gnosi 3.0.0. Existing public releases remain untouched.

## Updates

Production queries the existing public releases after successful startup.
Development disables update checks. Downloads and installation require user
actions: `autoDownload` and `autoInstallOnAppQuit` are both false.

macOS currently offers the official architecture-specific DMG in the external
browser. It does not offer automatic restart-and-install with the current ad-hoc
signatures. Windows/Linux retain the configured download/install flow; verify
the actual installed package format before claiming updater compatibility.
Background checks and version changes do not open release history automatically.
Users can open release notes explicitly from the Control Center.

## Architecture

### Renderer IPC boundary

`ipc-contract.d.ts` defines the data-only desktop API shared with the frontend.
The standalone CommonJS preload is checked with strict TypeScript/JSDoc; it does
not import local runtime modules, so it remains compatible with sandboxed
preloads. Run `pnpm --filter @gnosi/desktop typecheck:ipc` from the repository
root, and `pnpm test:desktop` for the transport and packaging contracts.

Each method owns one explicit IPC channel. Response decoders reject malformed
values; IPC failures remain rejected promises. Update callbacks receive only the
update state, and settings callbacks receive no arguments—never Electron event
objects or `event.sender`. Both subscription methods return an idempotent
disposer for that subscription. The existing channel-wide removal methods remain
available to older consumers. The renderer declaration still accepts partial
bridges for web-only operation and earlier desktop hosts.

The update contract includes `checking` and `not-available`; these background
states do not display an update prompt. The bridge tests use a fake host and never
download/install an update or fill an external form. Passing these tests does not
replace the real Electron and platform packaging acceptance matrix.

All eight main-process IPC handlers validate the sender before reading data or
performing an action. Only the current top-level frame of a live, registered
main window is accepted: `http://localhost:5173` in development or `app://gnosi`
when packaged. Child frames, detached frames, other windows and lookalike origins
are rejected. Main windows retain sandboxing and cannot navigate or redirect
outside that origin; HTTP(S) links opened in a new window use the external
browser. The application protocol also rejects other authorities before touching
the backend or bundled assets. Form windows have no preload bridge and cannot
request privileged IPC actions.

The form filler accepts only a credential-free HTTPS start URL and pins its
exact origin before loading. Navigation and redirect guards are installed
before `loadURL`; any cleartext or cross-origin destination is blocked. The
actual final `webContents` URL is checked again immediately before each
synthetic profile injection, so a redirect cannot receive profile bytes.

Seven handlers are extracted into the checked contract module; the form-filler
handler remains in main.js. Sender validation across all eight does not mean
that the entire main process is strictly typed.

### Isolated native IPC smoke test

Run `pnpm --filter @gnosi/desktop test:ipc:smoke` in a graphical desktop session.
It executes the installed Electron runtime with the real preload and sender
guard, not the production application entry point. It uses fresh temporary
application/session directories, blocks remote requests, and never starts the
backend, updater or form filler. It verifies request responses, event payloads,
subscription disposal, Node isolation and rejection of an unregistered window.

The command also exercises the native no-replace adapter on opaque fixture
bytes before opening its browser session. To test the same fixture inside ASAR,
run `node desktop/scripts/smoke-ipc-asar.cjs /absolute/path/to/Electron` from the
repository root. This launcher requires an installed executable and never
downloads one or starts the production application.

The command exits within 30 seconds, closes its own windows, and prints the
temporary directory containing `report.json` and `trusted-window.png`. An
`Untrusted IPC sender` log is expected for the deliberately rejected window.
The displayed release-candidate version is fictitious test data, not an app
version bump. Check the runtime version in the report: a pass on Electron 28
does not certify Electron 43, production startup, data migration, packaging or
automatic updates. The production handlers are additionally exercised with
operational doubles by `pnpm test:desktop`.

### Profile preservation and recovery

Chromium 150 only migrates cookie schema 23 → 24; it deletes/recreates older
cookie databases, including schema 19 used by Electron 28. Before opening
Chromium, Gnosi therefore validates all default and persistent-partition stores
and structurally converts known schemas 19–22 to 23. Chromium then performs its
supported 23 → 24 step. Unknown, corrupt, unresolved or custom encrypted stores
stop startup. Standard Gnosi bundles have Chromium cookie encryption disabled;
an encrypted store needs its original encryption-enabled runtime, not guessed
keys or a plaintext fallback. Do not delete `Cookies`, stamp its version metadata,
or launch a newer runtime directly against an unconverted old profile.
See the upstream [cookie migration cases](https://github.com/chromium/chromium/blob/150.0.7871.224/net/extras/sqlite/sqlite_persistent_cookie_store.cc#L1062-L1145)
and [older-schema reset](https://github.com/chromium/chromium/blob/150.0.7871.224/net/extras/sqlite/sqlite_persistent_store_backend_base.cc#L196-L208).

The conversion uses a staging copy of **only the cookie database**, checks its
full integrity, schema, record count and byte-aware projected record digest, then
activates it through atomic no-replace moves. The exact original file is retained
at `.Cookies.gnosi-cookie-recovery/original.sqlite`, beside `Cookies`, with private
intent/prepared/completed journals. No complete profile copy is made. Obsolete
SameParty data stays in that original archive; the active schema follows
Chromium's field removal. Key-normalization collisions abort instead of replacing
a cookie. Interrupted staging attempts are retained for diagnosis; only verified
states resume automatically. Keep recovery files until the upgrade is accepted.

The explicit `rollbackCookieStore` recovery helper requires all clients stopped
and a completed forward migration. It preserves the current/newer cookies as
`rollback.current.sqlite`, restores a verified copy of the original through its
own durable journals, and prevents automatic remigration by Electron 43. Finish
an interrupted rollback with the same helper, then use the previous Gnosi version.
Do not remove rollback journals to force a retry or overwrite newer cookies.
Pending forward activation must first be resumed to verified completion.

Close every older Gnosi instance before upgrading. Startup obtains a
single-instance lock before opening the backend, updater or browser session.
The pnpm package rename does not change the legacy `gnosi` runtime profile name;
explicit profile/session paths are retained. Packaged data overrides are selected
in order: `GNOSI_DATA_DIR`, `GNOSI_LOCAL_DATA`, `LOCAL_DATA_DIR`, then the existing
Electron user-data path. This compatibility fallback does not relocate an older
installation to a new platform default.

Electron 32 introduced cleanup of the obsolete `databases` directory under the
Chromium profile. Before opening a session, Gnosi saves that directory as opaque
data under `.<profile-name>.gnosi-electron-recovery/databases.saved`, beside the
profile. Cookies, localStorage, IndexedDB and Gnosi application-data siblings stay
in place. Separate user-data and session-data profiles are both checked. No whole
profile copy or SQLite rewrite is performed by this protection.

The recovery directory is created privately, with an exclusive intent journal
and a completion journal. An atomic operating-system **no-replace** rename keeps
the directory identity and contents; an existing destination is never replaced,
even if it appears during the operation. The narrow native adapter uses Koffi's
pinned, prebuilt Node-API modules. Its source-build hook is disabled. Linux
desktop builds require glibc and a filesystem supporting `RENAME_NOREPLACE`;
unsupported primitives fail closed without a copy/delete fallback.

On a conflict, malformed journal, missing native module, overlapping configured
data path or I/O failure, startup shows an error and exits before opening the
backend or renderer. Leave the profile and recovery directory intact. A complete
intent journal plus the matching original or saved directory can resume on the
next start. For ambiguous or truncated journals, stop all clients and inspect both
locations before recovery; do not delete a journal or overwrite either directory
to force startup. Never restore `databases.saved` under the vulnerable `databases`
name while running newer Electron. Keep the saved tree for explicit recovery;
Gnosi does not remove it automatically. This preserves legacy bytes, not the
removed Chromium WebSQL feature itself.

For an isolated persistence check, run
`pnpm --filter @gnosi/desktop test:profile:smoke` before replacing Electron 28.
After upgrading, pass the previous and target Electron executable paths as the
two arguments to that command. It runs old → target → target against a fresh
temporary profile, checking a synthetic mail draft, chat, three cookies and application
data sentinel, and saves reports/screenshots. The seed runtime must be older than
Electron 32. Test-only mock keychain settings prevent access to real credentials;
this check does not certify production OS-secret-store migration, real database
integrity, other platforms or packaged release acceptance.

Add `--asar` after the two executable paths to run the target probe from an ASAR4
archive containing the real profile helpers and host-native prebuild. This is an
isolated packaging-boundary fixture, not a full installer or backend bundle.
Missing local runtimes fail with installation guidance, without downloading.
The migration check compares cookie values, domain/host-only scope, path,
HttpOnly/Secure/SameSite flags and expiration across both target starts. A failure
at the safety gate is not a successful migration. Passing this fixture does not
replace the native installer, real data or four-platform release matrix.


## Source and generated resources

- `desktop/main.js`: main process, protocol and remaining form-filler handler.
- `desktop/preload.js`, `ipc-contract.d.ts`, `ipc-security.js` and
  `ipc-handlers.js`: renderer bridge, contracts and sender validation.
- `desktop/backend-process.js` and `backend-launch.js`: owned startup/readiness
  and packaged executable/data selection.
- `desktop/profile-startup.js`, profile/cookie helpers: preservation and recovery.
- `desktop/electron-builder.yml`, `build-python.sh` and `scripts/`:
  packaging configuration and resource/acceptance checks.
- `desktop/assets/`: reviewed distribution resources; generated installers do
  not belong here.
- `frontend/public/favicon.svg`: canonical application mark. The icon generator
  derives desktop resources; do not edit a packaged app to change branding.

The frozen backend bundles its locked runtime dependencies and reviewed
resources. End users do not need system Python, but provider credentials,
data access and platform-specific facilities still require their own setup.
Bundling dependencies is not a guarantee that every integration works offline.

## Troubleshooting and acceptance

| Symptom | Check | Preserve |
| --- | --- | --- |
| Blank development window | Vite HTTP localhost:5173, Python environment, backend startup diagnostics | Existing profile and data; do not start a competing backend |
| Startup protection error | Reported profile/recovery paths and journal state with all clients stopped | Original and recovery files; never delete journals to force startup |
| Missing packaged backend | PyInstaller output and final resource validation | Previous installer and verified backup; no system-Python fallback |
| Update failure | Actual release tag, architecture, manifest hashes and installation policy | Current installation/profile until recovery is verified |
| Python build fails | Python 3.11, uv lock, interpreter ABI and build logs | Existing good package; do not use Python 3.10 or an arbitrary newer version |

Main-process diagnostics use the launching process output; packaged-backend
output is forwarded there. Updater diagnostics use electron-log. Locate the
actual log for the running profile rather than assuming historical
`Cervell Digital` log directories.

From the repository root, run `pnpm test:desktop` and
`pnpm --filter @gnosi/desktop typecheck:ipc`, plus the isolated probes above
in a supported graphical environment. Review their reports/screenshots and
exit status. Do not confuse mock-host/source checks with a tested installer.

The [engineering desktop guide](https://gnosi.temenosismael.org/engineering/domains/desktop-clients/)
documents runtime boundaries, companion clients and the acceptance matrix.
Every supported platform still requires actual installation, first launch,
profile/data preservation, update and recovery evidence. Docker runtime and
authenticated browser acceptance are separate requirements.
