#!/bin/bash
set -e

echo "=== Building Python Backend Bundle ==="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$SCRIPT_DIR"
PYTHON_BUILD_DIR="$ELECTRON_DIR/python-build"
DIST_DIR="$ELECTRON_DIR/dist-python"
GNOSI_DIR="$(dirname "$ELECTRON_DIR")"
# Exported so the embedded Python heredoc below sees it via os.environ.
# Without `export`, Python falls back to a hardcoded user-specific path
# that doesn't exist in CI runners.
export BACKEND_DIR="$GNOSI_DIR/backend"

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

$PYTHON_VENV << PYSCRIPT
import os
import platform

backend_dir = os.environ['BACKEND_DIR']
system = platform.system().lower()

hiddenimports = [
    'flask', 'flask_cors', 'fastapi', 'uvicorn', 'psutil', 'pydantic',
    'numpy', 'networkx', 'requests', 'httpx', 'sqlalchemy',
    'bs4', 'feedparser', 'dotenv', 'yaml', 'google_auth_httplib2',
    'googleapiclient', 'google_auth_oauthlib', 'gtts', 'icalendar',
    'langchain', 'langchain_core', 'langchain_openai', 'langchain_ollama',
    'langchain_groq', 'langchain_anthropic', 'langgraph', 'langchain_chroma',
    'langgraph.checkpoint.sqlite.aio', 'chromadb', 'groq', 'cloudinary', 'simpleeval',
    'jinja2', 'itsdangerous', 'click', 'werkzeug', 'blinker',
    'dateutil', 'six', 'pytz', 'tzdata',
    'pydantic_core', 'pydantic_settings',
    'cryptography', 'cffi', 'pyasn1', 'pyasn1_modules',
    'httpcore', 'h11', 'anyio',
    'grpc', 'google.protobuf', 'google.api',
    'starlette', 'typing_extensions',
    'importlib_metadata', 'importlib_resources', 'zipp',
    'jsonschema', 'jsonschema_specifications', 'referencing', 'rpds',
    'pkg_resources', 'setuptools',
]

spec_content = f'''
# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['{backend_dir}/server.py'],
    pathex=['{backend_dir}'],
    binaries=[],
    datas=[
        ('{backend_dir}', 'backend'),
    ],
    hiddenimports={hiddenimports},
    hookspath=[],
    runtime_hooks=[],
    excludes=['tkinter', 'test', 'matplotlib', 'pandas', 'scipy'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name='cervell_backend',
    debug=False,
    strip=False,
    upx=True,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    name='cervell_backend',
)
'''

with open('backend.spec', 'w') as f:
    f.write(spec_content)

print(f"Created backend.spec with BACKEND_DIR={backend_dir}")
PYSCRIPT

$PYTHON_VENV -m PyInstaller backend.spec --clean --noconfirm

echo ""
echo "5. Copying build to dist-python..."
rm -rf "$DIST_DIR"

if [ -d "$PYTHON_BUILD_DIR/dist/cervell_backend" ]; then
    cp -r "$PYTHON_BUILD_DIR/dist/cervell_backend" "$DIST_DIR"
    echo "   Python bundle created at: $DIST_DIR"
    du -sh "$DIST_DIR"
elif [ -d "$PYTHON_BUILD_DIR/build/cervell_backend" ]; then
    cp -r "$PYTHON_BUILD_DIR/build/cervell_backend" "$DIST_DIR"
    echo "   Python bundle created at: $DIST_DIR"
    du -sh "$DIST_DIR"
else
    echo "Error: Python bundle not found"
    ls -la "$PYTHON_BUILD_DIR/dist/" 2>/dev/null || true
    ls -la "$PYTHON_BUILD_DIR/build/" 2>/dev/null || true
    exit 1
fi

"$PYTHON_VENV" "$ELECTRON_DIR/scripts/smoke-packaged-backend.py" "$DIST_DIR"

echo ""
echo "=== Python Build Complete ==="
