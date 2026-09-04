#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GNOSI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$GNOSI_DIR/frontend"
VERSION_SYNC_SCRIPT="$SCRIPT_DIR/scripts/sync-release-version.cjs"
METADATA_SCRIPT="$SCRIPT_DIR/scripts/release-metadata.cjs"
CATALOG_FILE="$FRONTEND_DIR/src/features/control-center/releases/releases.json"
CHANGELOG_FILE="$GNOSI_DIR/CHANGELOG.md"
EN_TRANSLATION_FILE="$FRONTEND_DIR/src/shared/i18n/locales/en/translation.json"
LOCK_FILES=("pnpm-lock.yaml" "uv.lock")
PREPARATION_FILES=(
    "package.json"
    "desktop/package.json"
    "frontend/package.json"
    "pyproject.toml"
    "frontend/src/features/control-center/releases/releases.json"
    "CHANGELOG.md"
)

usage() {
    echo "Usage:"
    echo "  ./desktop/release.sh prepare <version>"
    echo "  ./desktop/release.sh package <version>"
    echo "  ./desktop/release.sh promote <version> <verified-artifact-groups> <published-release-url>"
}

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

require_clean_tree() {
    if [ -n "$(git -C "$GNOSI_DIR" status --porcelain --untracked-files=all)" ]; then
        git -C "$GNOSI_DIR" status --short >&2
        fail "The release contract requires a clean worktree."
    fi
}

file_identity() {
    git -C "$GNOSI_DIR" hash-object -- "$1"
}

capture_lock_identities() {
    local lock_file
    for lock_file in "${LOCK_FILES[@]}"; do
        [ -f "$GNOSI_DIR/$lock_file" ] || fail "Missing frozen lock: $lock_file"
        file_identity "$lock_file"
    done
}

assert_lock_identities() {
    local before="$1"
    local after
    after="$(capture_lock_identities)"
    if [ "$before" != "$after" ]; then
        echo "ERROR: A frozen lock changed during the release operation." >&2
        return 1
    fi
}

check_versions() {
    node "$VERSION_SYNC_SCRIPT" --check "$1" \
        "$GNOSI_DIR/package.json" \
        "$SCRIPT_DIR/package.json" \
        "$FRONTEND_DIR/package.json" \
        "$GNOSI_DIR/pyproject.toml"
}

check_pending_metadata() {
    node "$METADATA_SCRIPT" check-pending "$1" "$CATALOG_FILE" \
        "$CHANGELOG_FILE" "$EN_TRANSLATION_FILE"
}

prepare_release() {
    local version="$1"
    local lock_identities
    local backup_dir
    local relative_file
    require_clean_tree
    lock_identities="$(capture_lock_identities)"
    backup_dir="$(mktemp -d "${TMPDIR:-/tmp}/gnosi-release-prepare.XXXXXX")"

    for relative_file in "${PREPARATION_FILES[@]}"; do
        mkdir -p "$backup_dir/$(dirname "$relative_file")"
        cp -p "$GNOSI_DIR/$relative_file" "$backup_dir/$relative_file"
    done

    if ! node "$VERSION_SYNC_SCRIPT" "$version" \
        "$GNOSI_DIR/package.json" \
        "$SCRIPT_DIR/package.json" \
        "$FRONTEND_DIR/package.json" \
        "$GNOSI_DIR/pyproject.toml" \
      || ! node "$METADATA_SCRIPT" pending "$version" "$CATALOG_FILE" \
        "$CHANGELOG_FILE" "$EN_TRANSLATION_FILE" \
      || ! node "$FRONTEND_DIR/scripts/release-notes.mjs" --check \
      || ! assert_lock_identities "$lock_identities"; then
        for relative_file in "${PREPARATION_FILES[@]}"; do
            cp -p "$backup_dir/$relative_file" "$GNOSI_DIR/$relative_file"
        done
        rm -rf -- "$backup_dir"
        fail "Release preparation failed; all preparation-owned files were restored."
    fi
    rm -rf -- "$backup_dir"
    echo "Release $version is prepared as unpublished metadata. Review and commit the diff before packaging."
}

package_release() {
    local version="$1"
    local lock_identities
    local platform_name
    require_clean_tree
    check_versions "$version"
    check_pending_metadata "$version"
    node "$FRONTEND_DIR/scripts/release-notes.mjs" --check
    lock_identities="$(capture_lock_identities)"

    export PNPM_CONFIG_OFFLINE=true
    export npm_config_offline=true
    export UV_OFFLINE=true
    export UV_FROZEN=true

    cd "$GNOSI_DIR"
    pnpm install --frozen-lockfile --offline --ignore-scripts
    pnpm build:frontend

    platform_name="$(uname -s)"
    case "$platform_name" in
        Darwin*) pnpm --filter @gnosi/desktop build:mac ;;
        Linux*) pnpm --filter @gnosi/desktop build:linux ;;
        MINGW*|MSYS*|CYGWIN*) pnpm --filter @gnosi/desktop build:win ;;
        *) fail "Unsupported packaging platform: $platform_name" ;;
    esac

    assert_lock_identities "$lock_identities"
    require_clean_tree
    echo "Immutable local artifacts for $version are ready in $SCRIPT_DIR/dist/."
}

promote_release() {
    local version="$1"
    local artifact_root="$2"
    local published_url="$3"
    local lock_identities
    local tag_commit
    local head_commit
    local artifact_group
    require_clean_tree
    check_versions "$version"
    check_pending_metadata "$version"
    lock_identities="$(capture_lock_identities)"
    [ -d "$artifact_root" ] || fail "Verified artifact group directory not found: $artifact_root"

    tag_commit="$(git -C "$GNOSI_DIR" rev-parse --verify "refs/tags/v$version^{commit}" 2>/dev/null)" \
        || fail "Annotated release tag v$version is missing."
    head_commit="$(git -C "$GNOSI_DIR" rev-parse HEAD)"
    [ "$tag_commit" = "$head_commit" ] || fail "Tag v$version does not identify the current immutable source."

    for artifact_group in macos-x64 macos-arm64 linux-arm64 windows-x64; do
        node "$SCRIPT_DIR/scripts/release-artifacts.cjs" validate "$artifact_group" \
            "$artifact_root/$artifact_group"
    done
    node "$METADATA_SCRIPT" published "$version" "$CATALOG_FILE" \
        "$CHANGELOG_FILE" "$EN_TRANSLATION_FILE" "$published_url"
    node "$FRONTEND_DIR/scripts/release-notes.mjs" --check
    assert_lock_identities "$lock_identities"
    echo "Published metadata for $version is promoted. Review and commit this follow-up diff."
}

MODE="${1:-}"
VERSION="${2:-}"
[ -n "$MODE" ] && [ -n "$VERSION" ] || { usage; exit 1; }

case "$MODE" in
    prepare)
        [ "$#" -eq 2 ] || { usage; exit 1; }
        prepare_release "$VERSION"
        ;;
    package)
        [ "$#" -eq 2 ] || { usage; exit 1; }
        package_release "$VERSION"
        ;;
    promote)
        [ "$#" -eq 4 ] || { usage; exit 1; }
        promote_release "$VERSION" "$3" "$4"
        ;;
    *)
        usage
        exit 1
        ;;
esac
