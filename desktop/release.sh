#!/bin/bash
set -e

echo "=== Cervell Digital - Release Script ==="
echo ""

VERSION=${1:-}
if [ -z "$VERSION" ]; then
    echo "Usage: ./release.sh <version>"
    echo "Example: ./release.sh 1.0.0"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$SCRIPT_DIR"
GNOSI_DIR="$(dirname "$ELECTRON_DIR")"
FRONTEND_DIR="$ELECTRON_DIR/../frontend"
VERSION_SYNC_SCRIPT="$ELECTRON_DIR/scripts/sync-release-version.cjs"

echo "Release version: $VERSION"
echo "Electron dir: $ELECTRON_DIR"
echo ""

cd "$ELECTRON_DIR"

echo "1. Checking git status..."
cd "$GNOSI_DIR"
if [ -n "$(git status --porcelain)" ]; then
    echo "Warning: There are uncommitted changes. Commit or stash them before releasing."
    git status --short
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo "2. Updating synchronized package versions..."
node "$VERSION_SYNC_SCRIPT" \
    "$VERSION" \
    "$GNOSI_DIR/package.json" \
    "$ELECTRON_DIR/package.json" \
    "$FRONTEND_DIR/package.json" \
    "$GNOSI_DIR/pyproject.toml"

pnpm install --lockfile-only
uv lock

ROOT_VERSION=$(node -p "require('$GNOSI_DIR/package.json').version")
ELECTRON_VERSION=$(node -p "require('$ELECTRON_DIR/package.json').version")
FRONTEND_VERSION=$(node -p "require('$FRONTEND_DIR/package.json').version")
PYTHON_VERSION=$(sed -n '/^\[project\]/,/^\[/s/^version = "\([^"]*\)"/\1/p' "$GNOSI_DIR/pyproject.toml" | head -1)

if [ "$ROOT_VERSION" != "$VERSION" ] || \
   [ "$ELECTRON_VERSION" != "$VERSION" ] || \
   [ "$FRONTEND_VERSION" != "$VERSION" ] || \
   [ "$PYTHON_VERSION" != "$VERSION" ]; then
    echo "ERROR: Version synchronization failed."
    echo "Root: $ROOT_VERSION"
    echo "Electron: $ELECTRON_VERSION"
    echo "Frontend: $FRONTEND_VERSION"
    echo "Python: $PYTHON_VERSION"
    exit 1
fi

echo "   Root: $ROOT_VERSION"
echo "   Electron: $ELECTRON_VERSION"
echo "   Frontend: $FRONTEND_VERSION"
echo "   Python: $PYTHON_VERSION"

echo ""
echo "3. Building frontend..."
cd "$GNOSI_DIR"
pnpm build:frontend

echo ""
# Each platform build runs build:python before electron-builder. Do not build
# Python separately here or every local release repeats the clean bundle build.
echo "4. Building Electron apps for current platform..."
cd "$ELECTRON_DIR"
PLATFORM=$(uname -s)
case "$PLATFORM" in
    Darwin*)
        pnpm --filter @gnosi/desktop build:mac
        ;;
    Linux*)
        pnpm --filter @gnosi/desktop build:linux
        ;;
    MINGW*|MSYS*|CYGWIN*)
        pnpm --filter @gnosi/desktop build:win
        ;;
    *)
        echo "Unknown platform: $PLATFORM"
        echo "Supported: macOS, Linux, Windows"
        exit 1
        ;;
esac

echo ""
echo "5. Listing built artifacts..."
ls -lh "$ELECTRON_DIR/dist/"*.{dmg,AppImage,deb,exe,zip} 2>/dev/null || ls -lh "$ELECTRON_DIR/dist/"

echo ""
echo "=== Release artifacts ready ==="
echo ""
echo "Artifacts location: $ELECTRON_DIR/dist/"
echo ""
echo "Next steps after this preparation is reviewed and merged:"
echo "  1. Update local main from origin/main."
echo "  2. Create the annotated tag v$VERSION on main."
echo "  3. Push the tag through the SSH origin remote."
echo "  4. Inspect the draft created in the public Gnosi repository."
