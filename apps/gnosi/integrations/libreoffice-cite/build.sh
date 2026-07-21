#!/usr/bin/env bash
#
# Empaqueta l'extensió Gnosi Cite en un fitxer .oxt (un ZIP) instal·lable
# a LibreOffice via Eines > Gestor d'extensions, o amb:
#
#     unopkg add gnosi-cite.oxt
#
# Ús: ./build.sh
#
set -euo pipefail

cd "$(dirname "$0")"

OUT="gnosi-cite.oxt"
rm -f "$OUT"

zip -r -X "$OUT" \
  description.xml \
  META-INF/manifest.xml \
  ProtocolHandler.xcu \
  Addons.xcu \
  gnosi_cite.py \
  README.md \
  -x '*.DS_Store' >/dev/null

echo "Construït: $OUT"
echo "Instal·la amb:  unopkg add --force \"$PWD/$OUT\""
