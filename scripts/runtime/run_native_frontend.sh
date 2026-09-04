#!/usr/bin/env bash
# Start the native frontend with the root workspace's pinned package manager.
# Usage: run_native_frontend.sh [VITE_ARGS...]. Configure ports in the process
# environment; Vite owns its dotenv files, which must never be sourced by shell.
set -euo pipefail

BASE="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd -- "$BASE"
# Uvicorn binds IPv4 explicitly. Using `localhost` here lets some macOS
# resolvers try ::1 first and adds a multi-second fallback to every proxied
# request even though the backend itself is healthy.
export VITE_BACKEND_HOST="${VITE_BACKEND_HOST-127.0.0.1}"
export VITE_BACKEND_PORT="${VITE_BACKEND_PORT-5002}"

validate_port() {
    local name="$1" value="$2"
    if [[ ! "$value" =~ ^[0-9]{1,5}$ ]] || (( 10#$value < 1 || 10#$value > 65535 )); then
        echo "ERROR: $name must be an integer between 1 and 65535." >&2
        exit 2
    fi
}
validate_port VITE_BACKEND_PORT "$VITE_BACKEND_PORT"
# Do not export a frontend default: that would shadow Vite's own dotenv value.
validate_port VITE_FRONTEND_PORT "${VITE_FRONTEND_PORT-5173}"

EXPECT_PORT=0
for ARG in "$@"; do
    if (( EXPECT_PORT )); then
        validate_port --port "$ARG"
        EXPECT_PORT=0
    elif [[ "$ARG" == --port ]]; then
        EXPECT_PORT=1
    elif [[ "$ARG" == --port=* ]]; then
        validate_port --port "${ARG#--port=}"
    fi
done
if (( EXPECT_PORT )); then validate_port --port ""; fi

# Never download a missing package manager during startup.
export COREPACK_ENABLE_NETWORK=0

REPO_ROOT="$(git -C "$BASE" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -n "$REPO_ROOT" ]]; then
    CURRENT_HEAD="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)"
    CURRENT_BRANCH="$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || true)"
    ORIGIN_MAIN="$(git -C "$REPO_ROOT" rev-parse refs/remotes/origin/main 2>/dev/null || true)"
    SHORT_HEAD="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || true)"
    export VITE_GNOSI_CHECKOUT_LABEL="${VITE_GNOSI_CHECKOUT_LABEL-${CURRENT_BRANCH:-detached}@${SHORT_HEAD:-unknown}}"
    HAS_REMOTE_BRANCH=0
    if [[ "$CURRENT_BRANCH" == "main" ]] \
        || git -C "$REPO_ROOT" show-ref --verify --quiet "refs/remotes/origin/$CURRENT_BRANCH"; then
        HAS_REMOTE_BRANCH=1
    fi

    if [[ "$HAS_REMOTE_BRANCH" == "1" && -n "$CURRENT_HEAD" && -n "$ORIGIN_MAIN" && "$CURRENT_HEAD" != "$ORIGIN_MAIN" ]] \
        && git -C "$REPO_ROOT" merge-base --is-ancestor "$CURRENT_HEAD" "$ORIGIN_MAIN"; then
        export VITE_GNOSI_STALE_CHECKOUT="${VITE_GNOSI_STALE_CHECKOUT-1}"
        echo "WARNING: Native frontend checkout is behind origin/main."
    else
        export VITE_GNOSI_STALE_CHECKOUT="${VITE_GNOSI_STALE_CHECKOUT-0}"
    fi
fi

exec corepack pnpm --filter @gnosi/frontend dev "$@"
