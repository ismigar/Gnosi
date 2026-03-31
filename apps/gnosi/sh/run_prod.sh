#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

VENV="$BASE_DIR/.venv"
BACKEND_DIR="$BASE_DIR/backend"
FRONTEND_DIR="$BASE_DIR/frontend"

echo "📦 Preparing and running Digital Brain (Production)..."
echo "Base directory: $BASE_DIR"
echo

# 0) Function to kill processes occupying a port
kill_on_port() {
    local PORT="$1"
    local PIDS

    PIDS=$(lsof -ti ":$PORT" 2>/dev/null || true)

    if [ -n "$PIDS" ]; then
        echo "⚠️  Closing previous processes on port $PORT: $PIDS"
        kill $PIDS 2>/dev/null || true
        sleep 1
        # If they still exist, kill -9
        PIDS=$(lsof -ti ":$PORT" 2>/dev/null || true)
        if [ -n "$PIDS" ]; then
            echo "⚠️  Forcing close (kill -9) on port $PORT: $PIDS"
            kill -9 $PIDS 2>/dev/null || true
        fi
    fi
}

# 1) Activate virtual environment
if [ -d "$VENV" ]; then
    echo "🔧 Activating virtual environment..."
    source "$VENV/bin/activate"
    echo "📦 Installing production dependencies..."
    "$VENV/bin/pip" install -r "$BASE_DIR/requirements.txt" >/dev/null
else
    echo "❌ .venv does not exist at $BASE_DIR"
    exit 1
fi

# 2) Read backend port
BACKEND_PORT=$(PYTHONPATH="$BASE_DIR" "$BASE_DIR/.venv/bin/python" - << 'PY'
from config.app_config import load_params
cfg = load_params(strict_env=False)
server = getattr(cfg, "server", {}) or cfg.get("server", {}) or {}
print(server.get("backend_port", 5001))
PY
)

echo "Detected port: $BACKEND_PORT"
kill_on_port "$BACKEND_PORT"
echo

# 3) Build Frontend
echo "🏗️  Building frontend..."
cd "$FRONTEND_DIR"
npm install >/dev/null 2>&1
VITE_BASE_PATH=/ npm run build

# 4) Run Backend (Gunicorn)
echo "🚀 Starting server (Gunicorn)..."
echo "👉 Open http://localhost:$BACKEND_PORT in your browser."
cd "$BASE_DIR"

# -w 4: 4 workers
# -b: bind address
# --access-logfile -: log to stdout
"$VENV/bin/gunicorn" -w 4 -b "0.0.0.0:$BACKEND_PORT" --access-logfile - backend.app:app
