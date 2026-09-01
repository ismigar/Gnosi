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
FRONTEND_DIR="$(cd "$SCRIPT_DIR/../../frontend" && pwd)"
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
# `Gnosi/frontend/src/features/reader/zotero/zotero-host.html`.
HOST_TEMPLATE="$FRONTEND_DIR/src/features/reader/zotero/zotero-host.html"
if [ -f "$HOST_TEMPLATE" ]; then
    cp "$HOST_TEMPLATE" "$PUBLIC_TARGET/host.html"
    echo "→ host.html copiat des de $HOST_TEMPLATE"
elif [ -f "$HOST_HTML_SOURCE" ]; then
    echo "→ host.html ja present al build (variant in-tree)"
else
    echo "WARN: host.html no trobat — el reader no podrà inicialitzar-se" >&2
fi

# --- i18n extra ---
# El bundle de Zotero per defecte només porta `en-US` (configurat al
# webpack.config.js del submodule). Per al frontend de Gnosi (català per
# defecte, espanyol opcional) baixem manualment `ca-AD` i `es-ES` des del
# repo de Zotero. El zotero-host.html els carregarà segons la `language`
# que el component React li passi al payload `init`.
#
# Reproductibilitat: el commit hash es llegeix de `.zotero-locale-commit`
# del submodule, que els scripts del propi reader actualitzen al build de
# pdfjs. Si no existeix (submodule no inicialitzat correctament), és un
# error fatal — abans feiem fallback a `master` que era no-determinista.
LOCALE_COMMIT_FILE="$READER_DIR/.zotero-locale-commit"
if [ ! -f "$LOCALE_COMMIT_FILE" ]; then
    echo "ERROR: no troba $LOCALE_COMMIT_FILE — submodule mal inicialitzat?" >&2
    echo "  prova: git submodule update --init --recursive" >&2
    exit 1
fi
LOCALE_COMMIT=$(cat "$LOCALE_COMMIT_FILE")
if [ -z "$LOCALE_COMMIT" ]; then
    echo "ERROR: $LOCALE_COMMIT_FILE és buit" >&2
    exit 1
fi
echo "→ Baixant traduccions de Zotero (commit $LOCALE_COMMIT)"

LOCALES_TARGET="$PUBLIC_TARGET/locales"
mkdir -p "$LOCALES_TARGET"
for lang in ca-AD es-ES; do
    mkdir -p "$LOCALES_TARGET/$lang"
    for file in zotero.ftl reader.ftl; do
        url="https://raw.githubusercontent.com/zotero/zotero/$LOCALE_COMMIT/chrome/locale/$lang/zotero/$file"
        out="$LOCALES_TARGET/$lang/$file"
        # -L: segueix redirects (raw.githubusercontent.com a vegades en fa)
        # --retry 3 --retry-connrefused: resilient a xarxa inestable
        # --fail (-f): codi != 0 per a non-2xx
        # -sS: silenciós però mostra errors a stderr
        if curl -sS -f -L --retry 3 --retry-connrefused -o "$out" "$url"; then
            echo "  · $lang/$file"
        else
            echo "WARN: No s'ha pogut baixar $url — fallback a en-US per a $lang/$file" >&2
            rm -f "$out"
        fi
    done
done
# Copiar també el `en-US/zotero.ftl` i `en-US/reader.ftl` del build (per
# si el host.html els demana amb `language: 'en-US'` explícit).
if [ -d "$READER_DIR/locales/en-US" ]; then
    mkdir -p "$LOCALES_TARGET/en-US"
    cp "$READER_DIR/locales/en-US"/*.ftl "$LOCALES_TARGET/en-US/" 2>/dev/null || true
fi

# Overlays Gnosi: el `chrome/locale/ca-AD/zotero/reader.ftl` de Zotero té
# ~15 claus sense traduir (literals en anglès, o plurals buits). El nostre
# overlay les omple. Es carrega com a primer bundle del `ftl: [...]` del
# createReader perquè Fluent dona prioritat al primer bundle que té la
# clau, així aquestes traduccions guanyen sense patchejar res del repo
# de Zotero.
OVERLAYS_DIR="$FRONTEND_DIR/src/features/reader/zotero/zotero-locale-overlays"
if [ -d "$OVERLAYS_DIR" ]; then
    for overlay in "$OVERLAYS_DIR"/*.ftl; do
        [ -f "$overlay" ] || continue
        lang=$(basename "$overlay" .ftl)
        mkdir -p "$LOCALES_TARGET/$lang"
        cp "$overlay" "$LOCALES_TARGET/$lang/gnosi-overlay.ftl"
        echo "  · overlay $lang/gnosi-overlay.ftl"
    done
fi

echo "✓ zotero-reader build completat a $PUBLIC_TARGET"
echo "  Verifica amb: curl -I http://localhost:5173/zotero-reader/host.html"
