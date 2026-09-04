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
# Interactive development uses uv's frozen environment guard. A persistent
# LaunchAgent can opt into the already-provisioned root environment so launchd
# directly owns Uvicorn instead of an intermediate `uv run` supervisor.
case "${GNOSI_NATIVE_DIRECT_VENV-0}" in
    1|true|TRUE|yes|YES|on|ON)
        VENV_PYTHON="$BASE/.venv/bin/python3"
        if [[ ! -x "$VENV_PYTHON" ]]; then
            echo "ERROR: Canonical Python environment is missing: $VENV_PYTHON" >&2
            exit 1
        fi
        PYTHON_RUNNER=("$VENV_PYTHON")
        ;;
    0|false|FALSE|no|NO|off|OFF)
        PYTHON_RUNNER=(uv run --project "$BASE" --frozen --no-sync python)
        ;;
    *)
        echo "ERROR: GNOSI_NATIVE_DIRECT_VENV must be a boolean value." >&2
        exit 2
        ;;
esac

exec "${PYTHON_RUNNER[@]}" - "$PORT" "$@" <<'PY'
import os
import sys

from backend.config.data_dir import resolve_data_dir
from backend.config.env_config import load_env

load_env()
os.environ.setdefault("GNOSI_DATA_DIR", str(resolve_data_dir()))
os.environ.setdefault("PYTHONUNBUFFERED", "1")
reload_value = os.environ.get("GNOSI_NATIVE_RELOAD", "1").strip().lower()
if reload_value in {"1", "true", "yes", "on"}:
    reload_enabled = True
elif reload_value in {"0", "false", "no", "off"}:
    reload_enabled = False
else:
    print(
        "ERROR: GNOSI_NATIVE_RELOAD must be a boolean value ",
        "(1/0, true/false, yes/no or on/off).",
        file=sys.stderr,
    )
    raise SystemExit(2)

uvicorn_args = [
    sys.executable,
    "-m",
    "uvicorn",
    "backend.server:app",
    "--host",
    "127.0.0.1",
    "--port",
    sys.argv[1],
]
if reload_enabled:
    uvicorn_args.extend(["--reload", "--reload-dir", "backend"])
uvicorn_args.extend(sys.argv[2:])
os.execv(
    sys.executable,
    uvicorn_args,
)
PY
