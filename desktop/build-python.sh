#!/bin/bash
set -e

echo "=== Building Python Backend Bundle ==="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$SCRIPT_DIR"
PYTHON_BUILD_DIR="$ELECTRON_DIR/python-build"
DIST_DIR="$ELECTRON_DIR/dist-python"
GNOSI_DIR="$(dirname "$ELECTRON_DIR")"
BACKEND_DIR="$GNOSI_DIR/backend"
RESOURCE_POLICY="$ELECTRON_DIR/scripts/backend_resources.py"

echo "   Script dir: $SCRIPT_DIR"
echo "   Electron dir: $ELECTRON_DIR"
echo "   Gnosi dir: $GNOSI_DIR"
echo "   Backend dir: $BACKEND_DIR"

cd "$ELECTRON_DIR"

echo ""
echo "1. Verifying the locked Python toolchain..."

PYTHON_CMD=""
PYTHON_VERSION=""

if [ -n "${GNOSI_PYTHON_CMD:-}" ]; then
    if ! command -v "$GNOSI_PYTHON_CMD" &> /dev/null; then
        echo "Error: requested Python command not found: $GNOSI_PYTHON_CMD"
        exit 1
    fi
    PYTHON_CMD="$GNOSI_PYTHON_CMD"
    PYTHON_VERSION=$("$PYTHON_CMD" --version)
elif command -v python3.11 &> /dev/null; then
    PYTHON_CMD="python3.11"
    PYTHON_VERSION=$(python3.11 --version)
else
    echo "Error: Python 3.11 not found."
    exit 1
fi

echo "   Using: $PYTHON_CMD ($PYTHON_VERSION)"

if [[ "$PYTHON_VERSION" != Python\ 3.11.* ]]; then
    echo "Error: Gnosi desktop packaging requires Python 3.11."
    exit 1
fi

# Reject missing/contaminated first-party resources before dependency work.
"$PYTHON_CMD" "$RESOURCE_POLICY" check-source --repository "$GNOSI_DIR"

if ! command -v uv &> /dev/null; then
    echo "Error: uv is required to consume the frozen Python lock."
    exit 1
fi

echo ""
echo "2. Creating virtual environment for clean build..."
# Keep packaging isolated while resolving exclusively from the repository lock.
VENV_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gnosi-python-venv.XXXXXX")"

cleanup_venv() {
    # Windows can briefly retain handles after PyInstaller exits. A failed
    # best-effort cleanup must not invalidate an otherwise valid package, and
    # the unique temporary path prevents it from blocking the next build.
    if ! rm -rf "$VENV_DIR"; then
        echo "Warning: could not remove temporary virtual environment: $VENV_DIR"
    fi
}
trap cleanup_venv EXIT

echo ""
echo "3. Synchronizing dependencies from uv.lock..."
UV_PROJECT_ENVIRONMENT="$VENV_DIR" uv sync \
    --project "$GNOSI_DIR" \
    --frozen \
    --no-default-groups \
    --group desktop \
    --python "$PYTHON_CMD"

# Cross-platform venv layout: POSIX uses bin/, Windows venvs use Scripts/.
# This script runs under Git Bash / MSYS on the Windows runner.
if [ -x "$VENV_DIR/Scripts/python.exe" ]; then
    PYTHON_VENV="$VENV_DIR/Scripts/python.exe"
else
    PYTHON_VENV="$VENV_DIR/bin/python"
fi

echo ""
echo "4. Running PyInstaller..."
mkdir -p "$PYTHON_BUILD_DIR"
cd "$PYTHON_BUILD_DIR"

# PyInstaller otherwise prompts before replacing a previous COLLECT directory.
# Release builds must be non-interactive and must never reuse a stale bundle.
rm -rf "$PYTHON_BUILD_DIR/build" "$PYTHON_BUILD_DIR/dist"

"$PYTHON_VENV" "$RESOURCE_POLICY" spec \
    --repository "$GNOSI_DIR" --output "$PYTHON_BUILD_DIR/backend.spec"

# Generated dependency archives stay outside the source tree so the policy
# never confuses a build output with an unselected repository data file.
"$PYTHON_VENV" -m PyInstaller backend.spec --clean --noconfirm \
    --workpath "$VENV_DIR/pyinstaller-work"

echo ""
echo "5. Copying build to dist-python..."

if [ -d "$PYTHON_BUILD_DIR/dist/cervell_backend" ]; then
    # Preserve the previous output when the new bundle violates the policy.
    "$PYTHON_VENV" "$RESOURCE_POLICY" verify \
        --repository "$GNOSI_DIR" --bundle "$PYTHON_BUILD_DIR/dist/cervell_backend"
    rm -rf "$DIST_DIR"
    cp -r "$PYTHON_BUILD_DIR/dist/cervell_backend" "$DIST_DIR"
    echo "   Python bundle created at: $DIST_DIR"
    du -sh "$DIST_DIR"
else
    echo "Error: Python bundle not found"
    ls -la "$PYTHON_BUILD_DIR/dist/" 2>/dev/null || true
    ls -la "$PYTHON_BUILD_DIR/build/" 2>/dev/null || true
    exit 1
fi

# Check actual output (including hook-added files) before running any backend.
"$PYTHON_VENV" "$RESOURCE_POLICY" verify \
    --repository "$GNOSI_DIR" --bundle "$DIST_DIR"

"$PYTHON_VENV" "$ELECTRON_DIR/scripts/smoke-packaged-backend.py" "$DIST_DIR"

echo ""
echo "=== Python Build Complete ==="
