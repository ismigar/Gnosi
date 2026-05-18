#!/usr/bin/env bash
# Build del visor PDF de Zotero (submodule) i instal·lació a public/ del
# frontend perquè Vite el serveixi com a `/zotero-reader/...`.
#
# Pre-requisits:
#   - Node 18+
#   - El submodule `frontend/vendor/zotero-reader` ha d'estar inicialitzat
#     amb els seus sub-submodules (pdfjs, epubjs):
#       git submodule update --init --recursive
#
# Aquest script no es crida automàticament al CI ni al build de Vite. Cal
# executar-lo una vegada després de clonar el repo, i de nou si el
# submodule s'actualitza. Els artifacts (build/, node_modules/, locales/)
# estan al `.gitignore`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/../frontend" && pwd)"
READER_DIR="$FRONTEND_DIR/vendor/zotero-reader"
PUBLIC_TARGET="$FRONTEND_DIR/public/zotero-reader"
HOST_HTML_SOURCE="$READER_DIR/build/web/host.html"

if [ ! -d "$READER_DIR/src" ]; then
    echo "Submodule no inicialitzat. Llançant: git submodule update --init --recursive"
    (cd "$(git -C "$READER_DIR" rev-parse --show-superproject-working-tree 2>/dev/null || \
            git -C "$FRONTEND_DIR/.." rev-parse --show-toplevel)" && \
     git submodule update --init --recursive)
fi

cd "$READER_DIR"

if [ ! -d node_modules ]; then
    echo "→ npm install (zotero-reader)"
    NODE_OPTIONS=--openssl-legacy-provider npm i --no-audit --no-fund
fi

echo "→ npm run build (zotero-reader)"
NODE_OPTIONS=--openssl-legacy-provider npm run build

if [ ! -d "$READER_DIR/build/web" ]; then
    echo "ERROR: build/web no existeix després del build" >&2
    exit 1
fi

# El host.html és part del codi de Gnosi (viu fora del bundle Zotero).
# Si no existeix dins build/web, el regenerem del template guardat al
# repo principal. Aquí esperem que ja hi sigui per al desenvolupament
# local; ho gestionem amb el copy a public/.
echo "→ Instal·lant a $PUBLIC_TARGET"
rm -rf "$PUBLIC_TARGET"
mkdir -p "$(dirname "$PUBLIC_TARGET")"
cp -R "$READER_DIR/build/web" "$PUBLIC_TARGET"

# Cal preservar el host.html nostre (que no ve del build de Zotero).
# El guardem versionat al repo principal i el copiem aquí; vegeu
# `monorepo/apps/gnosi/frontend/src/components/Vault/zotero-host.html`.
HOST_TEMPLATE="$FRONTEND_DIR/src/components/Vault/zotero-host.html"
if [ -f "$HOST_TEMPLATE" ]; then
    cp "$HOST_TEMPLATE" "$PUBLIC_TARGET/host.html"
    echo "→ host.html copiat des de $HOST_TEMPLATE"
elif [ -f "$HOST_HTML_SOURCE" ]; then
    echo "→ host.html ja present al build (variant in-tree)"
else
    echo "WARN: host.html no trobat — el reader no podrà inicialitzar-se" >&2
fi

echo "✓ zotero-reader build completat a $PUBLIC_TARGET"
echo "  Verifica amb: curl -I http://localhost:5173/zotero-reader/host.html"
