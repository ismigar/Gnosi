# Gnosi Desktop App

This folder contains the Electron wrapper for the Cervell Digital application, enabling cross-platform distribution for macOS, Linux, and Windows with a bundled Python backend.

## Requirements

- **Node.js** 22.22.2
- **pnpm** 11.19.0
- **Python** 3.11 and **uv**

## Quick Start

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Run in development mode (uses local Python and dev servers)
pnpm desktop:dev
```

In dev mode:
- Frontend runs at `http://localhost:5173`
- Backend runs at `http://localhost:5002`
- Electron window opens connected to dev servers

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

The command exits within 30 seconds, closes its own windows, and prints the
temporary directory containing `report.json` and `trusted-window.png`. An
`Untrusted IPC sender` log is expected for the deliberately rejected window.
The displayed release-candidate version is fictitious test data, not an app
version bump. Check the runtime version in the report: a pass on Electron 28
does not certify Electron 43, production startup, data migration, packaging or
automatic updates. The production handlers are additionally exercised with
operational doubles by `pnpm test:desktop`.

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
