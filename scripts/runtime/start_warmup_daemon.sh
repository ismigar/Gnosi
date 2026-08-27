#!/bin/bash
# Llança onedrive_warmup_daemon.py al host. Usa el VAULT_HOST_PATH del
# .env_shared del repo principal (~/Projectes) o el del worktree, segons quin
# existeixi.
#
# Ús:
#   scripts/runtime/start_warmup_daemon.sh           # foreground (log a stdout)
#   scripts/runtime/start_warmup_daemon.sh --bg      # background, log a /tmp
#
# El backend Docker el contacta via host.docker.internal:5009. Cal que el
# Mac no bloquegi connexions d'aquesta xarxa interna; per defecte Docker
# Desktop ho permet.
set -euo pipefail

cd "$(dirname "$0")/../.."

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
# Arrels permeses per al warmup. **Per defecte només el Vault** per
# seguretat: el daemon bind a 0.0.0.0 (cal perquè Docker hi accedeixi
# via host.docker.internal) i no té autenticació, així que qualsevol
# client LAN amb la firewall macOS oberta podria triggerar warmups i
# enumerar roots via /healthz. Si necessites obrir PDFs/imatges
# enllaçats fora del Vault (a Documents/Desktop d'OneDrive), defineix
# explícitament ONEDRIVE_WARMUP_ALLOWED_ROOTS al teu .env_shared,
# separades per ':', i preferiblement combina-ho amb un bind acotat:
#   ONEDRIVE_WARMUP_ALLOWED_ROOTS="$HOME/Library/CloudStorage/OneDrive-XXX"
#   ONEDRIVE_WARMUP_BIND=127.0.0.1   # si el contenidor pot accedir-hi
: "${ONEDRIVE_WARMUP_ALLOWED_ROOTS:=${VAULT_HOST_PATH}}"
export ONEDRIVE_WARMUP_ALLOWED_ROOTS
export ONEDRIVE_WARMUP_PORT="${ONEDRIVE_WARMUP_PORT:-5009}"
export ONEDRIVE_WARMUP_BIND="${ONEDRIVE_WARMUP_BIND:-0.0.0.0}"

DAEMON="$(pwd)/scripts/runtime/onedrive_warmup_daemon.py"

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
