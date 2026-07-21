#!/usr/bin/env bash
#
# Packages the Web Clipper for distribution.
#
# Produces two artifacts, because the two channels want different shapes:
#
#   gnosi-web-clipper.zip        the folder, for "Load unpacked" (development
#                                and the current GitHub release)
#   gnosi-web-clipper-store.zip  the extension's *contents* at the archive
#                                root, which is what the Chrome Web Store
#                                requires — it rejects a zip whose manifest.json
#                                is nested inside a directory.
#
# Usage: ./build.sh
set -euo pipefail

cd "$(dirname "$0")"

DEV_OUT="gnosi-web-clipper.zip"
STORE_OUT="gnosi-web-clipper-store.zip"
FILES=(manifest.json popup.html popup.js README.md)

for f in "${FILES[@]}"; do
    [ -f "$f" ] || { echo "ERROR: missing $f" >&2; exit 1; }
done

# The store rejects anything with a version it has already seen, so surface it.
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")

rm -f "$DEV_OUT" "$STORE_OUT"

# Dev shape: paths prefixed with web-clipper/ so unzipping gives a folder to
# point "Load unpacked" at. Zipped from the parent so the prefix is real.
(cd .. && zip -qX "web-clipper/$DEV_OUT" "${FILES[@]/#/web-clipper/}" -x '*.DS_Store')

# Store shape: manifest.json at the archive root.
zip -qX "$STORE_OUT" "${FILES[@]}" -x '*.DS_Store'

echo "Version $VERSION"
echo "  $DEV_OUT          (Load unpacked / GitHub release)"
echo "  $STORE_OUT  (Chrome Web Store upload)"
echo
echo "Before uploading to the store, read STORE_SUBMISSION.md — the listing"
echo "needs a privacy justification for each permission, and <all_urls> is the"
echo "one reviewers push back on."
