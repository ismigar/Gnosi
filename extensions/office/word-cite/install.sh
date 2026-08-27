#!/bin/bash
# Gnosi Cite — one-shot installer for Word on macOS.
#
# Does the two things a user would otherwise do by hand:
#   1. Copies the add-in manifest into Word's sideload folder (wef/).
#   2. Pins the task pane into Normal.dotm so every NEW blank document is
#      born tagged for autoopen (visibility="1"), which is what survives
#      Word quitting on macOS. See pin_taskpane.py and the directive
#      word_addin_persistence.md for why nothing simpler works.
#
# Windows does not need this script: a trusted-catalog add-in keeps its
# ribbon button there. LibreOffice does not need it either: the .oxt
# extension persists natively (see extensions/office/libreoffice-cite/).
#
# Usage:
#   ./install.sh              install (idempotent, keeps backups)
#   ./install.sh --status     show what is installed
#   ./install.sh --undo       restore pre-Gnosi Normal.dotm + remove manifest
#   ./install.sh --manifest PATH   use a manifest other than the repo one
#
# GNOSI_INSTALL_ALLOW_RUNNING=1 skips the "Word must be closed" guard
# (used by the test harness against a fake $HOME; never needed by users).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIN="$SCRIPT_DIR/pin_taskpane.py"
MANIFEST_DEFAULT="$SCRIPT_DIR/../../frontend/public/word-addin/manifest.xml"

WEF_DIR="$HOME/Library/Containers/com.microsoft.Word/Data/Documents/wef"
WEF_MANIFEST="$WEF_DIR/gnosi-word-addin-manifest.xml"
TEMPLATES_DIR="$HOME/Library/Group Containers/UBF8T346G9.Office/User Content.localized/Templates.localized"
NORMAL="$TEMPLATES_DIR/Normal.dotm"
# First-ever pre-Gnosi copy; --undo restores it. Never overwritten.
PRISTINE="$NORMAL.pre-gnosi"

MODE="install"
MANIFEST="$MANIFEST_DEFAULT"
while [ $# -gt 0 ]; do
    case "$1" in
        --status) MODE="status" ;;
        --undo) MODE="undo" ;;
        --manifest) shift; MANIFEST="${1:?--manifest necessita una ruta}" ;;
        -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Opció desconeguda: $1 (prova --help)" >&2; exit 2 ;;
    esac
    shift
done

fail() { echo "ERROR: $*" >&2; exit 1; }

# Run pin_taskpane.py quietly: its log goes to stderr, which is noise on
# success but exactly what you want to see on failure.
run_pin() {
    local out
    if ! out=$(python3 "$PIN" "$@" 2>&1); then
        echo "$out" >&2
        fail "pin_taskpane.py ha fallat."
    fi
}

[ "$(uname)" = "Darwin" ] || fail "Aquest instal·lador és només per a macOS. A Windows el botó ja persisteix (catàleg de confiança); vegeu el README."

# No pipe here on purpose: with pipefail, `unzip | grep -q` can report
# failure on a match (grep exits first, unzip dies on SIGPIPE with 141).
normal_is_pinned() {
    local listing
    listing=$(unzip -l "$NORMAL" 2>/dev/null || true)
    case "$listing" in
        *word/webextensions/taskpanes.xml*) return 0 ;;
        *) return 1 ;;
    esac
}

status() {
    echo "— Manifest (sideload):"
    if [ -f "$WEF_MANIFEST" ]; then
        local v
        # Anchor to a digit: a comment in the manifest also contains the
        # literal string "<Version>".
        v=$(grep -o "<Version>[0-9][0-9.]*" "$WEF_MANIFEST" | head -1 | cut -d'>' -f2)
        echo "    instal·lat (versió ${v:-?}) a $WEF_MANIFEST"
    else
        echo "    NO instal·lat"
    fi
    echo "— Normal.dotm (documents nous):"
    if [ ! -f "$NORMAL" ]; then
        echo "    no existeix (obre el Word un cop i torna a executar l'instal·lador)"
    elif normal_is_pinned; then
        echo "    fixat ✓ (els documents nous obren el panell sols)"
    else
        echo "    NO fixat"
    fi
    if [ -f "$PRISTINE" ]; then
        echo "— Còpia pre-Gnosi guardada: $PRISTINE"
    fi
    # Without this, `set -e` turns a missing pristine copy into exit code 1.
    return 0
}

if [ "$MODE" = "status" ]; then
    status
    exit 0
fi

# Word rewrites Normal.dotm from memory when it quits, which would silently
# revert the pin (or corrupt a half-written file). Refuse to race it.
if [ "${GNOSI_INSTALL_ALLOW_RUNNING:-0}" != "1" ] && pgrep -xq "Microsoft Word"; then
    fail "El Word està obert. Tanca'l del tot (Cmd+Q) i torna a executar això."
fi

if [ "$MODE" = "undo" ]; then
    if [ -f "$PRISTINE" ]; then
        cp "$PRISTINE" "$NORMAL"
        rm "$PRISTINE"
        echo "Normal.dotm restaurat a l'estat pre-Gnosi."
    elif [ -f "$NORMAL" ] && normal_is_pinned; then
        # No pristine copy (pinned by other means): strip our parts instead.
        run_pin "$NORMAL" --undo --no-backup
        echo "Parts del panell retirades de Normal.dotm."
    else
        echo "Normal.dotm ja estava sense fixar."
    fi
    if [ -f "$WEF_MANIFEST" ]; then
        rm "$WEF_MANIFEST"
        echo "Manifest retirat de $WEF_DIR."
    else
        echo "El manifest ja no hi era."
    fi
    echo "Fet. Els documents ja fixats individualment conserven les seves parts; per netejar-los: pin_taskpane.py DOC.docx --undo"
    exit 0
fi

# ---- install ----
command -v python3 >/dev/null || fail "Cal python3 (ve amb les Xcode Command Line Tools: xcode-select --install)."
[ -f "$PIN" ] || fail "No trobo pin_taskpane.py al costat de l'instal·lador."
[ -f "$MANIFEST" ] || fail "No trobo el manifest: $MANIFEST (usa --manifest PATH)."

# 1. Sideload manifest. Word re-reads it keyed on Id_Version, so overwriting
#    with a newer version is exactly how upgrades are delivered.
mkdir -p "$WEF_DIR"
cp "$MANIFEST" "$WEF_MANIFEST"
echo "1/2  Manifest instal·lat a wef/ ✓"

# 2. Pin Normal.dotm so new documents are born tagged.
if [ ! -f "$NORMAL" ]; then
    echo "2/2  AVÍS: Normal.dotm encara no existeix (el Word no s'ha obert mai en aquest compte)."
    echo "     Obre el Word un cop, tanca'l, i torna a executar l'instal·lador."
    echo "     Mentrestant el add-in ja es pot obrir a mà: Inici → Complements → Complements de desenvolupador."
    exit 0
fi
if normal_is_pinned; then
    echo "2/2  Normal.dotm ja estava fixat ✓"
else
    [ -f "$PRISTINE" ] || cp "$NORMAL" "$PRISTINE"
    run_pin "$NORMAL" --no-backup
    echo "2/2  Normal.dotm fixat ✓ (còpia pre-Gnosi: $(basename "$PRISTINE"))"
fi

cat <<'EOF'

Fet. Ara:
  1. Obre el Word i crea un document nou: el panell Gnosi Cite s'obre sol
     (el primer cop demana confiança per al complement: accepta-la).
  2. Documents EXISTENTS: obre'ls, insereix el add-in un cop
     (Inici → Complements → Complements de desenvolupador) i desa;
     o fixa'ls en lot sense obrir el Word:
         python3 pin_taskpane.py ELS_TEUS_DOCS/*.docx
  3. Compte amb el LibreOffice: si edites i deses un .docx fixat amb el
     Writer, les parts del panell es perden (LibreOffice les descarta en
     desar). Torna a passar-hi pin_taskpane.py. Al LibreOffice mateix no
     li cal res d'això: la seva extensió .oxt persisteix sola.

Per desfer-ho tot: ./install.sh --undo
EOF
