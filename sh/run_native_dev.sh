#!/usr/bin/env bash
# Arrenca el BACKEND de Gnosi de manera NATIVA (sense Docker), llegint el vault
# directament del host (evita l'EDEADLK de OneDrive via Docker/gRPC-FUSE).
# Ús: run_native_dev.sh [PORT]   (PORT per defecte 5002)
BASE="$(cd "$(dirname "$0")/.." && pwd)"          # monorepo/apps/gnosi
REPO_ROOT="$(cd "$BASE/../../.." && pwd)"          # Projectes

# 1) Variables compartides (API keys, client OAuth de Google, etc.).
# Es llegeix línia a línia (NO `source`): els valors poden tenir espais sense
# cometes (format env_file de Docker), que `source` interpretaria com a comandes.
if [ -f "$REPO_ROOT/.env_shared" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; *=*) export "$line" ;; esac
  done < "$REPO_ROOT/.env_shared"
fi

# 2) Variables específiques del runtime NATIU (sobreescriuen les de Docker)
export DIGITAL_BRAIN_VAULT_PATH="$HOME/Library/CloudStorage/OneDrive-UNED/Gnosi"
export VAULT_HOST_PATH="$DIGITAL_BRAIN_VAULT_PATH"
export BIBLIOTECA_HOST_PATH="$HOME/Library/CloudStorage/OneDrive-UNED/Biblioteca"
export HOME_HOST_PATH="$HOME"
export GNOSI_LOCAL_DATA="$BASE/local_data"
export PYTHONPATH="$BASE"
export AI_MODEL_URL="${AI_MODEL_URL:-http://localhost:11434/v1/chat/completions}"
export TRANSLATION_SERVER_URL=""   # translation-server queda fora (degrada bé)
export TZ="Europe/Madrid"
export PYTHONUNBUFFERED=1

PORT="${1:-5002}"
cd "$BASE"
echo "🚀 Backend natiu a 127.0.0.1:$PORT | vault=$DIGITAL_BRAIN_VAULT_PATH | data=$GNOSI_LOCAL_DATA"
exec .venv/bin/uvicorn backend.server:app --host 127.0.0.1 --port "$PORT" --reload --reload-dir backend
