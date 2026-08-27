#!/usr/bin/env bash
#
# generate_linux_baselines.sh — Generate Linux visual baselines.
#
# OFFICIAL APPROACH (recommended):
#   Trigger the GitHub Actions workflow `e2e-update-baselines.yml` manually:
#     1. GitHub UI → Actions → "E2E — Update Linux Visual Baselines (manual)" → Run.
#     2. Download the artifact "visual-baselines-linux".
#     3. Extract into tests/e2e/tests/visual/regression.spec.ts-snapshots/.
#     4. Commit + push.
#   Why: matches the exact CI environment (Ubuntu, glibc, font-config) byte-for-byte.
#
# LOCAL FALLBACK (best-effort, may fail):
#   This script attempts the same via Docker against the LOCAL Vite dev server.
#   Known issues: Vite HMR websocket + base path "./" can prevent React from
#   bootstrapping when accessed via host.docker.internal. If it fails, use the
#   official approach instead — don't fight Vite dev locally.
#
# Prereqs:
#   - Docker daemon running.
#   - gnosi_frontend container UP on :5173.
#   - host.docker.internal in vite.config.js `server.allowedHosts` (already set).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
E2E_DIR="$REPO_DIR/tests/e2e"
PLAYWRIGHT_VERSION="$(cd "$E2E_DIR" && node -p "require('./node_modules/@playwright/test/package.json').version")"
IMAGE="mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-jammy"

cat <<EOF
╔══════════════════════════════════════════════════════════════╗
║ Local Linux baseline generation (best-effort).               ║
║ If this fails, use the GitHub Actions workflow instead:      ║
║   .github/workflows/e2e-update-baselines.yml                 ║
╚══════════════════════════════════════════════════════════════╝
EOF

echo "→ Using Playwright Docker image: $IMAGE"

echo "→ Verifying frontend is reachable..."
if ! curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:5173/ | grep -qE "^[23]"; then
  echo "✗ Frontend not reachable at http://localhost:5173/ — start it first:"
  echo "    docker-compose up -d frontend"
  exit 2
fi

echo "→ Pulling $IMAGE (cached if present)..."
docker pull "$IMAGE" >/dev/null

echo "→ Running visual project inside Linux container..."
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -v "$REPO_DIR":/work \
  -w /work \
  -e GNOSI_BASE_URL=http://host.docker.internal:5173 \
  -e CI=1 \
  "$IMAGE" \
  sh -c "corepack enable && corepack prepare pnpm@11.19.0 --activate && pnpm install --frozen-lockfile && pnpm --filter @gnosi/e2e exec playwright test --project=visual --update-snapshots"

echo ""
echo "✓ Linux baselines generated at:"
echo "    $E2E_DIR/tests/visual/regression.spec.ts-snapshots/*-linux.png"
echo ""
echo "Next steps:"
echo "  git add tests/e2e/tests/visual/regression.spec.ts-snapshots/"
echo "  git commit -m 'chore(e2e): refresh Linux visual baselines'"
