#!/bin/bash
set -e

echo "=== Cervell Digital Electron Build Script ==="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$SCRIPT_DIR"

cd "$ELECTRON_DIR"

echo "1. Installing npm dependencies..."
npm install

echo ""
echo "2. Building frontend (if not already built)..."
if [ ! -d "../frontend/dist" ]; then
    echo "Frontend not built. Run 'cd ../frontend && npm run build' first."
    exit 1
fi
echo "Frontend dist found."

echo ""
echo "3. Running electron-builder..."
cd "$ELECTRON_DIR"
npm run build

echo ""
echo "=== Build complete! ==="
echo "Output files are in: $ELECTRON_DIR/dist/"
