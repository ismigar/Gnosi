#!/bin/bash
# Llança onedrive_warmup_daemon.py al host. Usa el VAULT_HOST_PATH del
# .env_shared del repo principal (~/Projectes) o el del worktree, segons quin
# existeixi.
#
# Ús:
#   sh/start_warmup_daemon.sh           # foreground (log a stdout)
#   sh/start_warmup_daemon.sh --bg      # background, log a /tmp
#
# El backend Docker el contacta via host.docker.internal:5009. Cal que el
# Mac no bloquegi connexions d'aquesta xarxa interna; per defecte Docker
# Desktop ho permet.
set -euo pipefail

cd "$(dirname "$0")/.."

# Extraiem només les variables que ens interessen del .env_shared. No fem
# `source` complet perquè el fitxer pot tenir valors amb espais sense
# quoting (ex: EVENT_USER_NAME=Ismael Garcia Fernandez) i bash hi falla.
extract_var() {
    local key="$1" file="$2"
    grep -E "^${key}=" "$file" 2>/dev/null | head -1 | sed -E "s/^${key}=//"
}

for env_file in \
    "$HOME/Projectes/.env_shared" \
    "$(pwd)/../../../../.env_shared"
do
    if [ -f "$env_file" ]; then
        VAULT_HOST_PATH="${VAULT_HOST_PATH:-$(extract_var DIGITAL_BRAIN_VAULT_PATH "$env_file")}"
        VAULT_HOST_PATH="${VAULT_HOST_PATH:-$(extract_var VAULT_PATH "$env_file")}"
        echo "Llegit env: $env_file"
        break
    fi
done

# Fallback al path típic d'aquest setup.
: "${VAULT_HOST_PATH:=/Users/$USER/Library/CloudStorage/OneDrive-UNED/Gnosi}"
export VAULT_HOST_PATH
# Arrels permeses per al warmup. Per defecte tota la carpeta OneDrive de
# l'usuari, així els enllaços a fitxers fora del Vault (Documents,
# Desktop dins d'OneDrive, etc.) també es poden materialitzar. El
# daemon valida amb `resolve()` + `relative_to()`, així que no hi ha
# bypass via symlinks o "..".
ONEDRIVE_ROOT_GUESS="/Users/$USER/Library/CloudStorage/OneDrive-UNED"
: "${ONEDRIVE_WARMUP_ALLOWED_ROOTS:=${ONEDRIVE_ROOT_GUESS}:${VAULT_HOST_PATH}}"
export ONEDRIVE_WARMUP_ALLOWED_ROOTS
export ONEDRIVE_WARMUP_PORT="${ONEDRIVE_WARMUP_PORT:-5009}"
export ONEDRIVE_WARMUP_BIND="${ONEDRIVE_WARMUP_BIND:-0.0.0.0}"

DAEMON="$(pwd)/sh/onedrive_warmup_daemon.py"

if [ "${1:-}" = "--bg" ]; then
    LOG=/tmp/onedrive_warmup_daemon.log
    PID=/tmp/onedrive_warmup_daemon.pid
    if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then
        echo "Ja està corrent (pid $(cat "$PID")). Para'l amb: kill $(cat "$PID")"
        exit 0
    fi
    nohup python3 "$DAEMON" > "$LOG" 2>&1 &
    echo $! > "$PID"
    echo "Llançat en background (pid $(cat "$PID")). Logs: $LOG"
else
    exec python3 "$DAEMON"
fi
