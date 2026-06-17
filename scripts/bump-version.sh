#!/usr/bin/env bash
#
# Puja la versió de Gnosi des d'UNA sola ordre i crea el tag que dispara el
# release multiplataforma (.github/workflows/build-release.yml).
#
# Manté sincronitzats:
#   - monorepo/apps/gnosi/frontend/package.json  (versió que mostra la UI)
#   - monorepo/apps/gnosi/electron/package.json  (versió de l'instal·lador)
# i crea un commit + tag anotat vX.Y.Z.
#
# Ús:
#   scripts/bump-version.sh <X.Y.Z[-prerelease]>
#     scripts/bump-version.sh 0.2.0
#     scripts/bump-version.sh 0.2.0-beta.1
#
# NO fa push (és irreversible: dispara CI i crea el draft release). Quan ho
# vulguis publicar:
#     git push origin HEAD --follow-tags
#
set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Ús: $0 <X.Y.Z[-prerelease]>   (p. ex. 0.2.0 o 0.2.0-beta.1)" >&2
  exit 1
fi

# SemVer bàsic: X.Y.Z amb prerelease opcional (-beta.1, -rc.2, ...).
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "❌ Versió no vàlida: '$VERSION'. Format: X.Y.Z o X.Y.Z-prerelease" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
TAG="v$VERSION"

if git -C "$REPO_ROOT" rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "❌ El tag $TAG ja existeix." >&2
  exit 1
fi
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
  echo "❌ L'arbre de treball té canvis sense commitejar. Neteja'ls primer." >&2
  exit 1
fi

FRONTEND_PKG="$REPO_ROOT/monorepo/apps/gnosi/frontend/package.json"
ELECTRON_PKG="$REPO_ROOT/monorepo/apps/gnosi/electron/package.json"

# Reemplaça NOMÉS el camp "version" de primer nivell (la primera ocurrència),
# preservant format i ordre de claus. Fem servir Node (portable Mac/Linux,
# sense dependre de sed BSD vs GNU) i no toquem cap package-lock.
V="$VERSION" node -e '
  const fs = require("fs");
  for (const f of process.argv.slice(1)) {
    const s = fs.readFileSync(f, "utf8");
    const out = s.replace(/("version":\s*")[^"]*(")/, `$1${process.env.V}$2`);
    if (out === s) { console.error("No s_ha trobat el camp version a " + f); process.exit(1); }
    fs.writeFileSync(f, out);
  }
' "$FRONTEND_PKG" "$ELECTRON_PKG"

echo "🔖 Versió → $VERSION (frontend + electron)"
git -C "$REPO_ROOT" add "$FRONTEND_PKG" "$ELECTRON_PKG"
git -C "$REPO_ROOT" commit -m "chore(release): $TAG"
git -C "$REPO_ROOT" tag -a "$TAG" -m "Gnosi $TAG"

echo "✅ Commit i tag $TAG creats (en local)."
echo "👉 Per disparar el build multiplataforma i el draft release:"
echo "     git push origin HEAD --follow-tags"
