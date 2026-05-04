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

echo "   Script dir: $SCRIPT_DIR"
echo "   Electron dir: $ELECTRON_DIR"
echo "   Gnosi dir: $GNOSI_DIR"
echo "   Backend dir: $BACKEND_DIR"

cd "$ELECTRON_DIR"

echo ""
echo "1. Finding best Python installation..."

PYTHON_CMD=""
PYTHON_VERSION=""

if command -v python3.13 &> /dev/null; then
    PYTHON_CMD="python3.13"
    PYTHON_VERSION=$(python3.13 --version)
elif command -v python3.12 &> /dev/null; then
    PYTHON_CMD="python3.12"
    PYTHON_VERSION=$(python3.12 --version)
elif command -v python3.11 &> /dev/null; then
    PYTHON_CMD="python3.11"
    PYTHON_VERSION=$(python3.11 --version)
elif command -v python3.10 &> /dev/null; then
    PYTHON_CMD="python3.10"
    PYTHON_VERSION=$(python3.10 --version)
elif command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
    PYTHON_VERSION=$(python3 --version)
else
    echo "Error: Python 3.10+ not found. Please install Python."
    exit 1
fi

echo "   Using: $PYTHON_CMD ($PYTHON_VERSION)"

if [[ "$PYTHON_VERSION" < "Python 3.10" ]]; then
    echo "Warning: Python 3.9 detected. For better compatibility, use Python 3.11+"
fi

echo ""
echo "2. Installing PyInstaller..."
$PYTHON_CMD -m pip install pyinstaller --quiet --upgrade pip

echo ""
echo "3. Creating virtual environment for clean build..."
VENV_DIR="$ELECTRON_DIR/.venv-python"
rm -rf "$VENV_DIR"
$PYTHON_CMD -m venv "$VENV_DIR"

PYTHON_VENV="$VENV_DIR/bin/python"
PIP_VENV="$VENV_DIR/bin/pip"

echo ""
echo "4. Activating virtual environment and installing dependencies..."
$PYTHON_VENV -m pip install --upgrade pip setuptools wheel

$PYTHON_VENV -m pip install PyYAML python-dotenv Flask flask-cors requests httpx fastapi uvicorn pydantic psutil
$PYTHON_VENV -m pip install notion-client networkx numpy sqlalchemy python-multipart feedparser beautifulsoup4
$PYTHON_VENV -m pip install google-auth-oauthlib google-auth-httplib2 google-api-python-client
$PYTHON_VENV -m pip install gTTS icalendar
$PYTHON_VENV -m pip install --no-deps langchain langchain-openai langgraph langchain-chroma langgraph-checkpoint-sqlite
$PYTHON_VENV -m pip install --no-deps groq cloudinary simpleeval
$PYTHON_VENV -m pip install chromadb || echo "Warning: ChromaDB may have issues"

echo ""
echo "5. Running PyInstaller..."
cd "$PYTHON_BUILD_DIR"

$PYTHON_VENV << PYSCRIPT
import os
import platform

backend_dir = os.environ.get('BACKEND_DIR', '/Users/ismaelgarciafernandez/Projectes/monorepo/apps/gnosi/backend')
system = platform.system().lower()

hiddenimports = [
    'flask', 'flask_cors', 'fastapi', 'uvicorn', 'psutil', 'pydantic',
    'numpy', 'networkx', 'requests', 'httpx', 'notion_client', 'sqlalchemy',
    'beautifulsoup4', 'feedparser', 'dotenv', 'PyYAML', 'google_auth_httplib2',
    'google_api_python_client', 'google_auth_oauthlib', 'gtts', 'icalendar',
    'langchain', 'langchain_openai', 'langgraph', 'langchain_chroma',
    'langgraph_checkpoints_sqlite', 'chromadb', 'groq', 'cloudinary', 'simpleeval',
    'jinja2', 'itsdangerous', 'click', 'werkzeug', 'blinker', 'flask_cors',
    'dateutil', 'six', 'pytz', 'tzdata',
    'pydantic_core', 'pydantic_settings',
    'cryptography', 'cffi', 'pyasn1', 'pyasn1_modules',
    'httpx', 'httpcore', 'h11', 'anyio',
    'grpcio', 'protobuf', 'googleapis_common_protos',
    'starlette', 'typing_extensions',
    'importlib_metadata', 'importlib_resources', 'zipp',
    'jsonschema', 'jsonschema_specifications', 'referencing', 'rpds_py',
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
    excludes=['tkinter', 'test', 'unittest', 'matplotlib', 'pandas', 'scipy', 'PIL'],
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

$PYTHON_VENV -m PyInstaller backend.spec --clean 2>&1 || true

echo ""
echo "6. Copying build to dist-python..."
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
    echo "Warning: Python bundle not found"
    ls -la "$PYTHON_BUILD_DIR/dist/" 2>/dev/null || true
    ls -la "$PYTHON_BUILD_DIR/build/" 2>/dev/null || true
fi

echo ""
echo "=== Python Build Complete ==="
