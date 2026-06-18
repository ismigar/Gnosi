#!/usr/bin/env bash
# Arrenca el FRONTEND de Gnosi de manera NATIVA (vite dev, :5173 HTTPS).
# El backend ha de córrer natiu a localhost:5002. El guard `predev` bloca si el
# contenidor gnosi_frontend encara viu → atura'l abans.
BASE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BASE/frontend"
export VITE_BACKEND_HOST="${VITE_BACKEND_HOST:-localhost}"
export VITE_BACKEND_PORT="${VITE_BACKEND_PORT:-5002}"
echo "🎨 Frontend natiu (vite) a :5173 → backend localhost:$VITE_BACKEND_PORT"
exec npm run dev
