# Cervell Digital - Electron Desktop App

This folder contains the Electron wrapper for the Cervell Digital application, enabling cross-platform distribution for macOS, Linux, and Windows with a bundled Python backend.

## Requirements

- **Node.js** 18+
- **npm** 9+
- **Python** 3.10+ (3.11+ recommended for better compatibility)

## Quick Start

```bash
# Install dependencies
cd electron
npm install

# Run in development mode (uses local Python and dev servers)
npm run dev
```

In dev mode:
- Frontend runs at `http://localhost:5173`
- Backend runs at `http://localhost:5002`
- Electron window opens connected to dev servers

## Building

### Prerequisites

1. Build the frontend:
```bash
cd ../frontend
npm run build
```

2. Ensure Python 3.10+ is installed:
```bash
python3 --version  # Should be 3.10 or higher
```

### Build Python Bundle

```bash
cd electron
npm run build:python
```

This creates a self-contained Python environment in `dist-python/`.

### Build Electron App

```bash
# Build for current platform only
npm run build

# Or build for specific platforms
npm run build:mac    # macOS (.dmg) - x64 + arm64
npm run build:linux  # Linux (.AppImage, .deb)
npm run build:win    # Windows (.exe)
```

### Cross-Platform Build Notes

For production releases, build on each target platform:

| Platform | Machine | Python Version |
|----------|---------|----------------|
| macOS x64 | Intel Mac | Python 3.11+ |
| macOS ARM64 | Apple Silicon | Python 3.11+ |
| Linux x64 | Linux | Python 3.11+ |
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

The app uses `electron-updater` with GitHub Releases for automatic updates.

When a new version is published to GitHub:
1. Create a GitHub Release with the tag `v{x.y.z}`
2. Upload the artifacts from `dist/`
3. App will automatically detect and prompt for update

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

```
electron/
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
- Notion, Google APIs
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
