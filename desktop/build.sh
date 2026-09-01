#!/bin/bash
set -e

echo "=== Cervell Digital Electron Build Script ==="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$SCRIPT_DIR"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIST="$REPO_ROOT/frontend/dist"

echo "1. Installing frozen workspace dependencies..."
cd "$REPO_ROOT"
pnpm install --frozen-lockfile

echo ""
echo "2. Checking frontend build..."
if [ ! -d "$FRONTEND_DIST" ]; then
    echo "Frontend not built. Run 'pnpm build:frontend' from the Gnosi root first."
    exit 1
fi
echo "Frontend dist found."

echo ""
echo "3. Running electron-builder..."
cd "$REPO_ROOT"
pnpm --filter @gnosi/desktop build

echo ""
echo "=== Build complete! ==="
echo "Output files are in: $ELECTRON_DIR/dist/"
