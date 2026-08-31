#!/usr/bin/env bash
#
# Generate candidate Linux snapshots explicitly, without mounting the checkout.
# Requires an existing local image with Node 22.22.2, pnpm 11.19.0 and the locked
# Playwright browsers. Nothing is pulled; dependency installation is container-only.
# See ../SKILL.md for the temporary Linux opt-in and authentication limitations.

set -euo pipefail

fail() { echo "✗ $*" >&2; exit 2; }

if [ "$#" -ne 3 ] || [ "$1" != --update-snapshots ] || [ "$2" != --output-dir ]; then
  fail 'Usage: generate_linux_baselines.sh --update-snapshots --output-dir /new/output-directory'
fi
[ -n "${GNOSI_PLAYWRIGHT_IMAGE:-}" ] || fail 'Set GNOSI_PLAYWRIGHT_IMAGE to a prepared local image.'
[ -n "${GNOSI_BASE_URL:-}" ] || fail 'Set GNOSI_BASE_URL to the existing frontend URL reachable from the container.'
URL_PATTERN='^https?://([^/?#@[:space:]]+)([/?#][^[:space:]]*)?$'
[[ "$GNOSI_BASE_URL" =~ $URL_PATTERN ]] || fail 'GNOSI_BASE_URL must be HTTP(S), without credentials or whitespace.'
PROBE_URL="${GNOSI_BASE_URL%%://*}://${BASH_REMATCH[1]}/"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd -P)"
case "$3" in /*) ;; *) fail 'Output directory must be an absolute path.' ;; esac
OUTPUT_NAME="$(basename "$3")"
case "$OUTPUT_NAME" in ''|.|..|/) fail 'Choose a new, named output directory.' ;; esac
OUTPUT_PARENT="$(cd "$(dirname "$3")" && pwd -P)"
OUTPUT_DIR="$OUTPUT_PARENT/$OUTPUT_NAME"
case "$OUTPUT_DIR/" in
  "$REPO_DIR/"*|*/node_modules/*|*/.git/*|*/.venv/*|*/.pnpm-store/*)
    fail 'Output must be outside the checkout and dependency directories.' ;;
esac
if [ -e "$OUTPUT_DIR" ] || [ -L "$OUTPUT_DIR" ]; then
  fail 'Output already exists; choose a new directory. Existing baselines are never overwritten.'
fi

TASK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gnosi-linux-baselines.XXXXXXXX")"
cleanup() { rm -rf -- "$TASK_DIR"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
case "$TASK_DIR" in *,*) fail 'Temporary directory cannot contain a comma (Docker mount syntax).' ;; esac
mkdir -p "$TASK_DIR/source" "$TASK_DIR/output"

# Copy only the reviewed inputs: no source mount, host node_modules, auth state,
# certificates, .npmrc, .env, vaults or existing snapshots enter the container.
INPUTS=(
  package.json pnpm-lock.yaml pnpm-workspace.yaml .node-version
  frontend/package.json desktop/package.json tests/e2e/package.json
  scripts/verify-toolchain.mjs patches/emscripten-wasm-loader@3.0.3.patch
  tests/e2e/playwright.config.ts tests/e2e/tests/setup/auth.setup.ts
  tests/e2e/tests/visual/regression.spec.ts
)
for INPUT in "${INPUTS[@]}"; do
  WALK="$REPO_DIR"
  IFS=/ read -r -a PARTS <<< "$INPUT"
  for PART in "${PARTS[@]}"; do
    WALK="$WALK/$PART"
    [ ! -L "$WALK" ] || fail "Refusing symlink input: $INPUT"
  done
  [ -f "$WALK" ] || fail "Missing required input: $INPUT"
  mkdir -p "$TASK_DIR/source/$(dirname "$INPUT")"
  cp "$WALK" "$TASK_DIR/source/$INPUT"
done

echo '→ Explicit Linux generation: frozen dependencies and visual tests run only in the container.'
echo '→ The Darwin-only guard is removed only in the disposable copy; source baselines remain untouched.'
if docker run --rm --pull=never --init --cap-drop=ALL \
  --security-opt=no-new-privileges --shm-size=1g \
  --add-host=host.docker.internal:host-gateway \
  --mount "type=bind,src=$TASK_DIR/source,dst=/source,readonly" \
  --mount "type=bind,src=$TASK_DIR/output,dst=/export" \
  --env "GNOSI_BASE_URL=$GNOSI_BASE_URL" --env "GNOSI_PROBE_URL=$PROBE_URL" \
  --env "GNOSI_TEST_VAULT_ID=${GNOSI_TEST_VAULT_ID:-}" \
  --env CI=1 --env PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 --env COREPACK_ENABLE_NETWORK=0 \
  --entrypoint /bin/bash -i -- "$GNOSI_PLAYWRIGHT_IMAGE" -s <<'CONTAINER_SCRIPT'
set -euo pipefail
fail() { echo "✗ $*" >&2; exit 2; }
[ "$(node --version)" = v22.22.2 ] || fail 'Container requires Node 22.22.2.'
[ "$(pnpm --version)" = 11.19.0 ] || fail 'Container requires pnpm 11.19.0.'
if ! STATUS="$(curl --disable --fail --silent --show-error --location \
  --max-redirs 5 --max-time 3 --proto '=http,https' --proto-redir '=http,https' \
  --insecure --globoff --output /dev/null --write-out '%{http_code}' "$GNOSI_PROBE_URL")"; then
  fail 'Container cannot reach the selected frontend; no tests ran.'
fi
[[ "$STATUS" =~ ^2[0-9][0-9]$ ]] || fail 'Frontend must return a final HTTP 2xx.'

WORK_DIR="$(mktemp -d /tmp/gnosi-linux-work.XXXXXXXX)"
cp -R /source/. "$WORK_DIR/"
cd "$WORK_DIR"
# Skip package lifecycle scripts: only Playwright tests are needed, not Electron
# native builds. Browser binaries must already match the locked Playwright version.
pnpm install --frozen-lockfile --ignore-scripts
node scripts/verify-toolchain.mjs
cmp pnpm-lock.yaml /source/pnpm-lock.yaml
cmp pnpm-workspace.yaml /source/pnpm-workspace.yaml

# This is generation-only opt-in, never a change to the shared test contract.
# Fail on a changed guard instead of silently rewriting unfamiliar source.
SPEC=tests/e2e/tests/visual/regression.spec.ts
DARWIN_GUARD="test.skip(process.platform !== 'darwin', 'Visual baselines are recorded on macOS only.');"
if ! awk -v guard="$DARWIN_GUARD" '
  $0 == guard { count++; next }
  { print }
  END { if (count != 1) exit 2 }
' "$SPEC" > "$SPEC.tmp"; then
  fail 'Visual platform guard changed; review the generation-only Linux opt-in before retrying.'
fi
mv "$SPEC.tmp" "$SPEC"
pnpm --filter @gnosi/e2e exec playwright test --project=visual --update-snapshots --workers=1 --retries=0

SNAPSHOTS=tests/e2e/tests/visual/regression.spec.ts-snapshots
[ ! -L "$SNAPSHOTS" ] || fail 'Snapshot directory must not be a symlink.'
for ROUTE in home vault calendar contacts; do
  for VIEWPORT in desktop mobile; do
    FILE="$SNAPSHOTS/$ROUTE-$VIEWPORT-visual-linux.png"
    [ -f "$FILE" ] && [ ! -L "$FILE" ] || fail "Missing regular snapshot: $FILE"
    [ "$(od -An -tx1 -N8 "$FILE" | tr -d ' \n')" = 89504e470d0a1a0a ] || fail "Invalid PNG: $FILE"
  done
done
# Copy only the eight reviewed names, after validating the entire set.
for ROUTE in home vault calendar contacts; do
  for VIEWPORT in desktop mobile; do
    FILE="$ROUTE-$VIEWPORT-visual-linux.png"
    cp "$SNAPSHOTS/$FILE" "/export/$FILE"
    chmod 644 "/export/$FILE"
  done
done
CONTAINER_SCRIPT
then
  :
else
  STATUS=$?
  echo '✗ Linux generation failed; no candidates exported to the requested directory.' >&2
  exit "$STATUS"
fi

# A successful container exit alone is insufficient (all tests may have skipped).
for ROUTE in home vault calendar contacts; do
  for VIEWPORT in desktop mobile; do
    FILE="$TASK_DIR/output/$ROUTE-$VIEWPORT-visual-linux.png"
    [ -f "$FILE" ] && [ ! -L "$FILE" ] || fail "Missing regular Linux candidate: $ROUTE/$VIEWPORT"
    [ "$(od -An -tx1 -N8 "$FILE" | tr -d ' \n')" = 89504e470d0a1a0a ] || fail "Invalid Linux candidate: $ROUTE/$VIEWPORT"
  done
done
mkdir "$OUTPUT_DIR"
for ROUTE in home vault calendar contacts; do
  for VIEWPORT in desktop mobile; do
    FILE="$ROUTE-$VIEWPORT-visual-linux.png"
    cp "$TASK_DIR/output/$FILE" "$OUTPUT_DIR/$FILE"
  done
done
echo "✓ Eight Linux candidates exported to $OUTPUT_DIR"
echo 'Review the images explicitly; no tracked baselines were updated and CI does not run Linux visual comparisons.'
