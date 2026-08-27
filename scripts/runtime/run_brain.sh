#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"


echo "📦 Starting Gnosi (Flask + Vite)…"
echo "Base directory: $BASE_DIR"
echo

# ─────────────────────────────────────────────
# 0) Function to kill processes occupying a port
# ─────────────────────────────────────────────
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

# ─────────────────────────────────────────────
# 1) Virtual Environment
# ─────────────────────────────────────────────
uv sync --project "$BASE_DIR" --frozen
echo "Using the frozen uv environment"
echo

# ─────────────────────────────────────────────
# 2) Read ports from params.yaml
# ─────────────────────────────────────────────
BACKEND_PORT=$(uv run --project "$BASE_DIR" python - << 'PY'
from config.app_config import load_params
cfg = load_params(strict_env=False)
server = getattr(cfg, "server", {}) or cfg.get("server", {}) or {}
print(server.get("backend_port", 5001))
PY
)

FRONTEND_PORT=$(uv run --project "$BASE_DIR" python - << 'PY'
from config.app_config import load_params
cfg = load_params(strict_env=False)
server = getattr(cfg, "server", {}) or cfg.get("server", {}) or {}
print(server.get("frontend_port", 5173))
PY
)

export VITE_BACKEND_PORT="$BACKEND_PORT"
export VITE_FRONTEND_PORT="$FRONTEND_PORT"
export VITE_BASE_PATH="/"

echo "Ports: backend=$BACKEND_PORT · frontend=$FRONTEND_PORT"
echo

# ─────────────────────────────────────────────
# 3) Kill possible previous processes on ports
# ─────────────────────────────────────────────
kill_on_port "$BACKEND_PORT"
kill_on_port "$FRONTEND_PORT"
echo

# ─────────────────────────────────────────────
# 4) Cleanup and trap function before starting
# ─────────────────────────────────────────────
cleanup() {
  echo
  echo "🛑 Stopping services…"
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
      kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
      kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  echo "✔ Services stopped."
  exit 0
}

trap cleanup INT

# ─────────────────────────────────────────────
# 5) Backend (Flask)
# ─────────────────────────────────────────────
echo "🧠 Starting BACKEND (python -m backend.app)…"
cd "$BASE_DIR"
uv run --project "$BASE_DIR" python -m backend.app &
BACKEND_PID=$!
echo "   → PID backend: $BACKEND_PID"
echo

# ─────────────────────────────────────────────
# 6) Frontend (Vite)
# ─────────────────────────────────────────────
echo "🌐 Starting FRONTEND Vite at http://localhost:$FRONTEND_PORT ..."
cd "$BASE_DIR"
pnpm install --frozen-lockfile
pnpm --filter @gnosi/frontend dev -- --port "$FRONTEND_PORT" &
FRONTEND_PID=$!
echo "   → PID frontend: $FRONTEND_PID"
echo

# ─────────────────────────────────────────────
# 7) Status message and wait
# ─────────────────────────────────────────────
echo "🚀 All services started!"
echo "   BACKEND:  http://localhost:$BACKEND_PORT"
echo "   FRONTEND: http://localhost:$FRONTEND_PORT"
echo "Press CTRL+C to exit."
echo

# Wait for one of them to finish (usually until CTRL+C)
wait
