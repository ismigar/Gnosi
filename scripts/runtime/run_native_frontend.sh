#!/usr/bin/env bash
# Starts the Gnosi frontend natively (Vite dev server on port 5173).
# The backend must run natively on localhost:5002. The `predev` guard blocks
# startup while the legacy gnosi_frontend container is still running.
BASE="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$BASE"
export VITE_BACKEND_HOST="${VITE_BACKEND_HOST:-localhost}"
export VITE_BACKEND_PORT="${VITE_BACKEND_PORT:-5002}"

REPO_ROOT="$(git -C "$BASE" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -n "$REPO_ROOT" ]]; then
    CURRENT_HEAD="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)"
    CURRENT_BRANCH="$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || true)"
    ORIGIN_MAIN="$(git -C "$REPO_ROOT" rev-parse refs/remotes/origin/main 2>/dev/null || true)"
    SHORT_HEAD="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || true)"
    export VITE_GNOSI_CHECKOUT_LABEL="${CURRENT_BRANCH:-detached}@${SHORT_HEAD:-unknown}"
    HAS_REMOTE_BRANCH=0
    if [[ "$CURRENT_BRANCH" == "main" ]] \
        || git -C "$REPO_ROOT" show-ref --verify --quiet "refs/remotes/origin/$CURRENT_BRANCH"; then
        HAS_REMOTE_BRANCH=1
    fi

    if [[ "$HAS_REMOTE_BRANCH" == "1" && -n "$CURRENT_HEAD" && -n "$ORIGIN_MAIN" && "$CURRENT_HEAD" != "$ORIGIN_MAIN" ]] \
        && git -C "$REPO_ROOT" merge-base --is-ancestor "$CURRENT_HEAD" "$ORIGIN_MAIN"; then
        export VITE_GNOSI_STALE_CHECKOUT=1
        echo "⚠️  Native frontend is serving merged checkout $VITE_GNOSI_CHECKOUT_LABEL, behind origin/main."
    else
        export VITE_GNOSI_STALE_CHECKOUT=0
    fi
fi

echo "🎨 Native frontend (Vite) on :5173 → backend localhost:$VITE_BACKEND_PORT"
exec pnpm --filter @gnosi/frontend dev
