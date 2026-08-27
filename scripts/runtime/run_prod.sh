#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"


echo "📦 Preparing and running Gnosi (Production)..."
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

# 1) Synchronize the locked production environment.
uv sync --project "$BASE_DIR" --frozen --no-default-groups

# 2) Read backend port
BACKEND_PORT=$(PYTHONPATH="$BASE_DIR" uv run --project "$BASE_DIR" python - << 'PY'
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
cd "$BASE_DIR"
pnpm install --frozen-lockfile
VITE_BASE_PATH=/ pnpm build:frontend

# 4) Run Backend (Gunicorn)
echo "🚀 Starting server (Gunicorn)..."
echo "👉 Open http://localhost:$BACKEND_PORT in your browser."
cd "$BASE_DIR"

# -w 4: 4 workers
# -b: bind address
# --access-logfile -: log to stdout
uv run gunicorn -w 4 -b "0.0.0.0:$BACKEND_PORT" --access-logfile - backend.app:app
