#!/bin/bash
set -e

echo "=== Cervell Digital - Cross-Platform Build ==="
echo ""
echo "This script builds the Python backend bundle for the current platform."
echo "For full cross-platform builds, run on each target platform."
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$SCRIPT_DIR"

cd "$ELECTRON_DIR"

echo "Current platform: $(uname -s)"
echo ""

case "$(uname -s)" in
    Darwin*)
        echo "Detected: macOS"
        ARCH=$(uname -m)
        if [ "$ARCH" = "arm64" ]; then
            echo "Architecture: Apple Silicon (M1/M2/M3)"
        else
            echo "Architecture: Intel"
        fi
        ;;
    Linux*)
        echo "Detected: Linux"
        ;;
    MINGW*|MSYS*|CYGWIN*)
        echo "Detected: Windows"
        ;;
    *)
        echo "Unknown platform: $(uname -s)"
        ;;
esac

echo ""
echo "Starting Python bundle build..."
echo ""

./build-python.sh

echo ""
echo "=== Build Summary ==="
echo "Python bundle: $ELECTRON_DIR/dist-python/"
du -sh "$ELECTRON_DIR/dist-python/" 2>/dev/null || true
echo ""
echo "Next steps:"
echo "  1. npm run build:mac   (on macOS)"
echo "  2. npm run build:linux (on Linux)"
echo "  3. npm run build:win    (on Windows)"
