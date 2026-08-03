#!/usr/bin/env bash
#
# Configura HTTPS local de confiança per al dev server (Vite), necessari
# per provar els Office Add-ins (Word/Excel exigeixen que el taskpane es
# carregui per HTTPS, i el WebView rebutja un autofirmat no de confiança).
#
# Usa mkcert per:
#   1. Instal·lar una CA local al clauer del sistema (Word s'hi refiarà)
#   2. Generar un certificat per a localhost a frontend/certs/
#
# Després, vite.config.js detecta els certs i serveix per HTTPS
# automàticament (si no hi són, segueix en HTTP).
#
# Ús:
#   sh/setup-https-dev.sh
#   # i reinicia el contenidor del frontend perquè Vite rellegeixi la config:
#   docker compose restart frontend
#
set -euo pipefail

# Arrel de l'app (aquest script viu a sh/).
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="$APP_DIR/frontend/certs"

if ! command -v mkcert >/dev/null 2>&1; then
  echo "❌ mkcert no està instal·lat."
  echo "   macOS:  brew install mkcert nss"
  echo "   Linux:  consulta https://github.com/FiloSottile/mkcert#installation"
  exit 1
fi

echo "→ Instal·lant la CA local de mkcert (pot demanar la contrasenya)…"
mkcert -install

echo "→ Generant certificat per a localhost a $CERT_DIR …"
mkdir -p "$CERT_DIR"
mkcert \
  -cert-file "$CERT_DIR/localhost.pem" \
  -key-file "$CERT_DIR/localhost-key.pem" \
  localhost 127.0.0.1 ::1

echo ""
echo "✅ Fet. Certificats a frontend/certs/ (gitignorats)."
echo "   Reinicia el frontend perquè Vite serveixi per HTTPS:"
echo "       docker compose restart frontend"
echo "   o, si l'executes en local:"
echo "       cd frontend && npm run dev"
echo ""
echo "   Comprova-ho:  curl -sI https://localhost:5173/word-addin/index.html"
