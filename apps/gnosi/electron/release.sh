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
MONOREPO_DIR="$(dirname "$(dirname "$ELECTRON_DIR")")"

echo "Release version: $VERSION"
echo "Electron dir: $ELECTRON_DIR"
echo ""

cd "$ELECTRON_DIR"

echo "1. Checking git status..."
cd "$MONOREPO_DIR"
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
echo "2. Updating version in package.json..."
cd "$ELECTRON_DIR"
npm pkg set version="$VERSION"

echo ""
echo "3. Building frontend..."
cd "$ELECTRON_DIR/../frontend"
if [ ! -d "dist" ]; then
    npm run build
fi

echo ""
echo "4. Building Python bundle..."
cd "$ELECTRON_DIR"
./build-python.sh

echo ""
echo "5. Building Electron apps for current platform..."
PLATFORM=$(uname -s)
case "$PLATFORM" in
    Darwin*)
        npm run build:mac
        ;;
    Linux*)
        npm run build:linux
        ;;
    MINGW*|MSYS*|CYGWIN*)
        npm run build:win
        ;;
    *)
        echo "Unknown platform: $PLATFORM"
        echo "Supported: macOS, Linux, Windows"
        exit 1
        ;;
esac

echo ""
echo "6. Listing built artifacts..."
ls -lh "$ELECTRON_DIR/dist/"*.{dmg,AppImage,deb,exe,zip} 2>/dev/null || ls -lh "$ELECTRON_DIR/dist/"

echo ""
echo "=== Release artifacts ready ==="
echo ""
echo "Artifacts location: $ELECTRON_DIR/dist/"
echo ""
echo "To create a GitHub release:"
echo "  1. Go to https://github.com/ismaelgarciafernandez/projectes/releases/new"
echo "  2. Create tag: v$VERSION"
echo "  3. Upload files from dist/"
echo "  4. Publish release"
echo ""
echo "Or use GitHub CLI:"
echo "  gh release create v$VERSION --draft --title 'Cervell Digital $VERSION' $ELECTRON_DIR/dist/*"
