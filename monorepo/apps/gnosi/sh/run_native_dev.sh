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
# Vault per defecte: mana el valor de `.env_shared` (ja és ruta de host). Només
# si no hi és, caiem al vault Principal. MAI l'arrel OneDrive-UNED/Gnosi: des
# del multi-vault és el CONTENIDOR de vaults (Principal/, Notion/, …) —
# apuntar-hi el backend re-crea tota l'estructura (BD/, Mail/, Assets/…) a
# l'arrel i el Mail sync hi bolca la bústia sencera.
export DIGITAL_BRAIN_VAULT_PATH="${DIGITAL_BRAIN_VAULT_PATH:-$HOME/Library/CloudStorage/OneDrive-UNED/Gnosi/Principal}"
export VAULT_HOST_PATH="$DIGITAL_BRAIN_VAULT_PATH"
# (BIBLIOTECA_HOST_PATH retirada: la Biblioteca viu DINS de cada vault —
# vault-first pur, 2026-07-03 — i es resol sempre com <vault>/Biblioteca.)
export HOME_HOST_PATH="$HOME"
# Materialització de fitxers online-only d'OneDrive en NATIU. El backend corre
# sota launchd i un procés de launchd NO pot disparar la baixada on-access
# (el File Provider torna EDEADLK instantani); per tant llegir-los en procés
# (mode "direct") NO funciona. El mode "open" ho delega a LaunchServices
# (`open -g -j -a Preview`), que llança una app GUI a la sessió Aqua que sí pot
# llegir-los. Vegeu services/files_provider/onedrive.py i la memòria
# feedback_onedrive_warmup_native (exploració 2026-07-06).
export ONEDRIVE_WARMUP_MODE="open"
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
