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
echo
echo "Instal·la per la GUI: Eines > Gestor d'extensions > Afegeix"
echo "  $PWD/$OUT"
echo
echo "NO facis servir 'unopkg add --force' sobre una versió ja instal·lada:"
echo "l'error del named pipe avorta el reemplaçament en silenci i la caché es"
echo "queda amb el payload VELL. Per línia d'ordres, 'unopkg remove"
echo "com.gnosi.cite' primer, i verifica amb 'unopkg list | grep -A6 gnosi'"
echo "que digui 'is registered: yes'."
