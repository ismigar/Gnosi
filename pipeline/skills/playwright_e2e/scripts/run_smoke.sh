#!/usr/bin/env bash
#
# run_smoke.sh — Check an existing frontend, then run the anonymous smoke suite.
#
# Usage:
#   bash pipeline/skills/playwright_e2e/scripts/run_smoke.sh
#
# Env vars:
#   GNOSI_BASE_URL  Explicit Playwright base URL; otherwise match config's cert detection.
#   STRICT          Obsolete: unavailable services always fail, including STRICT=0.
# No services, dependencies or browsers are started/installed by this wrapper.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
E2E_DIR="$REPO_DIR/tests/e2e"
BASE_URL="${GNOSI_BASE_URL:-}"
if [ -z "$BASE_URL" ]; then
  # Match tests/e2e/playwright.config.ts without reading certificate contents.
  if [ -e "$REPO_DIR/frontend/certs/localhost.pem" ]; then
    BASE_URL="https://localhost:5173"
  else
    BASE_URL="http://localhost:5173"
  fi
fi

# Smoke navigates to '/', which resolves to the origin even with a base URL path.
# Reject credentials and whitespace; curl validates the remaining host/port syntax.
URL_PATTERN='^https?://([^/?#@[:space:]]+)([/?#][^[:space:]]*)?$'
if [[ ! "$BASE_URL" =~ $URL_PATTERN ]]; then
  echo "✗ GNOSI_BASE_URL must be an HTTP(S) URL without credentials or whitespace." >&2
  exit 2
fi
PROBE_URL="${BASE_URL%%://*}://${BASH_REMATCH[1]}/"

echo "→ Checking frontend at $PROBE_URL"
# --disable must be first: a user's .curlrc must not alter this readiness check.
# --insecure matches config's ignoreHTTPSErrors for local development certificates.
# Follow redirects, but accept only a final 2xx and a successful curl exit status.
if ! HTTP_STATUS="$(curl --disable --fail --silent --show-error --location \
  --max-redirs 5 --max-time 3 --proto '=http,https' --proto-redir '=http,https' \
  --insecure --globoff --output /dev/null --write-out '%{http_code}' "$PROBE_URL")"; then
  echo "✗ Frontend request failed — smoke did not run." >&2
  exit 2
fi
if [[ ! "$HTTP_STATUS" =~ ^2[0-9][0-9]$ ]]; then
  echo "✗ Frontend did not return a final HTTP 2xx response — smoke did not run." >&2
  exit 2
fi

echo "→ Running smoke (chromium-anon project)"
cd "$E2E_DIR"
export GNOSI_BASE_URL="$BASE_URL"
# Replace the wrapper so Playwright/pnpm's exit status reaches the caller unchanged.
exec pnpm exec playwright test --project=chromium-anon --workers=1
