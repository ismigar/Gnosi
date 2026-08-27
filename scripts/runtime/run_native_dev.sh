#!/usr/bin/env bash
# Arrenca el BACKEND de Gnosi de manera NATIVA (sense Docker), llegint el vault
# directament del host (evita l'EDEADLK de OneDrive via Docker/gRPC-FUSE).
# Ús: run_native_dev.sh [PORT]   (PORT per defecte 5002)
BASE="$(cd "$(dirname "$0")/../.." && pwd)"

# 1) La configuració del procés té prioritat. Després ve el `.env` local i,
# només si s'ha configurat explícitament, el fitxer compartit.
load_env_defaults() {
  local env_file="$1"
  [ -f "$env_file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
      [A-Za-z_]*=*)
        local key="${line%%=*}"
        case "$key" in
          ''|*[!A-Za-z0-9_]*) continue ;;
        esac
        if [ -z "${!key+x}" ]; then export "$line"; fi
        ;;
    esac
  done < "$env_file"
}
load_env_defaults "$BASE/.env"
if [ -n "${GNOSI_SHARED_ENV_FILE:-}" ]; then
  load_env_defaults "$GNOSI_SHARED_ENV_FILE"
fi

# 2) Variables específiques del runtime NATIU (sobreescriuen les de Docker)
# Vault per defecte: mana la configuració efectiva (ja és ruta de host). Només
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
if [ -z "${GNOSI_DATA_DIR:-}" ]; then
  if [ -n "${GNOSI_LOCAL_DATA:-}" ]; then
    export GNOSI_DATA_DIR="$GNOSI_LOCAL_DATA"
    echo "⚠️  GNOSI_LOCAL_DATA està obsolet; configura GNOSI_DATA_DIR."
  elif [ "$(uname -s)" = "Darwin" ]; then
    export GNOSI_DATA_DIR="$HOME/Library/Application Support/Gnosi"
  else
    export GNOSI_DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnosi"
  fi
fi
# Àlies compatible durant tota la sèrie 3.x per a complements antics.
export GNOSI_LOCAL_DATA="${GNOSI_LOCAL_DATA:-$GNOSI_DATA_DIR}"
export PYTHONPATH="$BASE"
export AI_MODEL_URL="${AI_MODEL_URL:-http://localhost:11434/v1/chat/completions}"
export TRANSLATION_SERVER_URL=""   # translation-server queda fora (degrada bé)
export TZ="Europe/Madrid"
export PYTHONUNBUFFERED=1

PORT="${1:-5002}"
cd "$BASE"
echo "🚀 Backend natiu a 127.0.0.1:$PORT | vault=$DIGITAL_BRAIN_VAULT_PATH | data=$GNOSI_DATA_DIR"
exec uv run uvicorn backend.server:app --host 127.0.0.1 --port "$PORT" --reload --reload-dir backend
