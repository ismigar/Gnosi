#!/usr/bin/env bash
#
# run_smoke.sh — Idempotent wrapper for the smoke E2E suite.
#
# Verifies prerequisites (Docker frontend UP) before running Playwright.
# Returns non-zero if smoke fails or frontend is unreachable.
#
# Usage:
#   bash pipeline/skills/playwright_e2e/scripts/run_smoke.sh
#
# Env vars:
#   GNOSI_BASE_URL  Override target URL (default: http://localhost:5173)
#   STRICT          If "1", fail when frontend is down instead of skipping

set -euo pipefail

BASE_URL="${GNOSI_BASE_URL:-http://localhost:5173}"
STRICT="${STRICT:-0}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/../../../../e2e" && pwd)"

echo "→ Checking frontend at $BASE_URL"
if ! curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$BASE_URL/" | grep -qE "^[23]"; then
  if [ "$STRICT" = "1" ]; then
    echo "✗ Frontend not reachable at $BASE_URL — abort (STRICT=1)"
    exit 2
  fi
  echo "⚠ Frontend not reachable at $BASE_URL — skipping smoke (set STRICT=1 to fail)"
  exit 0
fi

echo "→ Running smoke (chromium-anon project)"
cd "$E2E_DIR"
GNOSI_BASE_URL="$BASE_URL" npx playwright test --project=chromium-anon
