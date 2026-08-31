#!/usr/bin/env bash
# Start the native backend using the existing, frozen root Python environment.
# Usage: run_native_dev.sh [PORT] [UVICORN_ARGS...] (default port: 5002).
set -euo pipefail

BASE="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd -- "$BASE"

PORT="${1-5002}"
if (( $# > 0 )); then
    shift
fi
validate_port() {
    local value="$1"
    # Bound the length before arithmetic; never evaluate input as shell code.
    if [[ ! "$value" =~ ^[0-9]{1,5}$ ]] || (( 10#$value < 1 || 10#$value > 65535 )); then
        echo "ERROR: Backend port must be an integer between 1 and 65535." >&2
        exit 2
    fi
}
validate_port "$PORT"
PORT="$((10#$PORT))"

# Validate forwarded overrides too, while preserving every argument boundary.
EXPECT_PORT=0
for ARG in "$@"; do
    if (( EXPECT_PORT )); then
        validate_port "$ARG"
        EXPECT_PORT=0
    elif [[ "$ARG" == --port ]]; then
        EXPECT_PORT=1
    elif [[ "$ARG" == --port=* ]]; then
        validate_port "${ARG#--port=}"
    fi
done
if (( EXPECT_PORT )); then validate_port ""; fi

# Do not source or parse dotenv in shell. The canonical loader owns precedence,
# quoting, explicit shared files and credentials; the resolver owns data aliases.
# No dependency synchronization, installation, service discovery or fallback.
exec uv run --project "$BASE" --frozen --no-sync python - "$PORT" "$@" <<'PY'
import os
import sys

from backend.config.data_dir import resolve_data_dir
from backend.config.env_config import load_env

load_env()
os.environ.setdefault("GNOSI_DATA_DIR", str(resolve_data_dir()))
os.environ.setdefault("PYTHONUNBUFFERED", "1")
os.execv(
    sys.executable,
    [
        sys.executable, "-m", "uvicorn", "backend.server:app",
        "--host", "127.0.0.1", "--port", sys.argv[1],
        "--reload", "--reload-dir", "backend", *sys.argv[2:],
    ],
)
PY
