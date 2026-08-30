# Gnosi Desktop App

This folder contains the Electron wrapper for the Cervell Digital application, enabling cross-platform distribution for macOS, Linux, and Windows with a bundled Python backend.

## Requirements

- **Node.js** 22.22.2
- **pnpm** 11.19.0
- **Python** 3.11 and **uv**

The desktop toolchain pins Electron **43.4.1**, electron-builder **26.15.3**
and ASAR **4.3.0**. Electron's bundled Node runtime is independent of the
Node 22.22.2 used to install and build the workspace.

## Quick Start

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Download the pinned Electron binary explicitly, with its bundled checksums
pnpm --filter @gnosi/desktop install:runtime

# Run in development mode (uses local Python and dev servers)
pnpm desktop:dev
```

In dev mode:
- Frontend runs at `http://localhost:5173`
- Backend runs at `http://localhost:5002`
- Electron window opens connected to dev servers

Electron 43 no longer downloads its binary in an install hook. The workspace
keeps that hook disabled, alongside the unused Squirrel.Windows hook and Koffi's
source-build hook. Do not approve all dependency scripts to fix an installation.
The explicit runtime command is safe to repeat when the correct binary is
already present. Normal Electron CLI startup can download a missing binary;
the profile smoke runner deliberately does not and reports how to install it.

## Building

### Prerequisites

1. Build the frontend:
```bash
pnpm build:frontend
```

2. Ensure Python 3.11 is installed:
```bash
python3.11 --version
```

### Build Python Bundle

```bash
pnpm --filter @gnosi/desktop build:python
```

This creates a self-contained Python environment in `dist-python/`.

### Build Electron App

```bash
# Build for current platform only
pnpm package:desktop

# Or build for specific platforms
pnpm --filter @gnosi/desktop build:mac
pnpm --filter @gnosi/desktop build:linux
pnpm --filter @gnosi/desktop build:win
```

### Cross-Platform Build Notes

For production releases, build on each target platform:

| Platform | Machine | Python Version |
|----------|---------|----------------|
| macOS x64 | Intel Mac | Python 3.11+ |
| macOS ARM64 | Apple Silicon | Python 3.11+ |
| Linux ARM64 | Linux ARM64 | Python 3.11+ |
| Windows x64 | Windows | Python 3.11+ |

Python 3.9 from Xcode Command Line Tools bundles incorrectly on Apple Silicon. Use Python 3.11+ from homebrew or python.org.

## Release Process

1. Create a version tag:
```bash
./release.sh 1.0.0
```

2. This will:
   - Update version in package.json
   - Build frontend
   - Build Python bundle
   - Build Electron app for current platform
   - List artifacts in `dist/`

3. Upload artifacts to GitHub Release

## Auto-Updates

The app uses `electron-updater` with the public `ismigar/Gnosi` GitHub Releases.

When a new version is published to GitHub:
1. Create a GitHub Release with the tag `v{x.y.z}`
2. Upload the installers, `latest*.yml`, blockmaps, and the macOS ZIP target
3. The app detects the release and offers a download action
4. After download, the user selects **Restart and install**

Draft releases are not visible to update clients. Downloads never start without
the user's action.

## Distribution

### GitHub Releases Workflow

1. Update version and build:
```bash
./release.sh 1.0.0
```

2. Create GitHub Release:
```bash
gh release create v1.0.0 \
  --title "Cervell Digital 1.0.0" \
  --notes "Release notes here" \
  dist/*.dmg dist/*.AppImage dist/*.deb dist/*Setup.exe
```

### Artifacts

After build, artifacts are in `dist/`:
- **macOS**: `Cervell Digital-{version}-{arch}.dmg`
- **Linux**: `Cervell Digital-{version}-{arch}.AppImage`, `.deb`
- **Windows**: `Cervell Digital-{version}-Setup.exe`

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

```
desktop/
├── main.js           # Main process (Electron)
├── preload.js        # Context bridge (secure IPC)
├── package.json      # Dependencies and build config
├── electron-builder.yml  # Build configuration
├── build.sh          # Simple build script
├── build-python.sh   # Python bundling with PyInstaller
├── build-all.sh      # Cross-platform build helper
├── release.sh        # Release automation
└── README.md         # This file
```

## Bundle Contents

The Python bundle (`dist-python/`) includes:
- FastAPI + Uvicorn
- LangChain + LangGraph
- ChromaDB
- Notion connector and Google APIs
- All backend dependencies

This makes the app fully standalone - no Python installation required on user machines.

## Troubleshooting

### Backend doesn't start

Check logs in:
- **macOS**: `~/Library/Logs/Cervell Digital/`
- **Linux**: `~/.config/Cervell Digital/logs/`
- **Windows**: `%APPDATA%/Cervell Digital/logs/`

### Update fails

Ensure GitHub release has:
- Tag format: `v{version}` (e.g., `v1.0.0`)
- Assets uploaded to the release

### PyInstaller build fails

Ensure Python 3.10+ is installed:
```bash
python3 --version
# If < 3.10, install newer version:
# macOS: brew install python@3.11
# Linux: sudo apt install python3.11
# Windows: Download from python.org
```

### macOS ARM64 build issues

Python 3.9 from Xcode Command Line Tools has compatibility issues with ARM64.
Use Python 3.11+ from homebrew:
```bash
brew install python@3.11
/opt/homebrew/bin/python3.11 --version
```
