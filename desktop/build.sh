#!/bin/bash
set -e

echo "=== Cervell Digital Electron Build Script ==="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$SCRIPT_DIR"

cd "$ELECTRON_DIR"

echo "1. Installing frozen workspace dependencies..."
cd "$(dirname "$ELECTRON_DIR")"
pnpm install --frozen-lockfile

echo ""
echo "2. Building frontend (if not already built)..."
if [ ! -d "../frontend/dist" ]; then
    echo "Frontend not built. Run 'pnpm build:frontend' from the Gnosi root first."
    exit 1
fi
echo "Frontend dist found."

echo ""
echo "3. Running electron-builder..."
cd "$(dirname "$ELECTRON_DIR")"
pnpm --filter @gnosi/desktop build

echo ""
echo "=== Build complete! ==="
echo "Output files are in: $ELECTRON_DIR/dist/"
