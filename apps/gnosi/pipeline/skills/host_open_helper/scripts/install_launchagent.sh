#!/bin/sh
# Instal·la (o reinstal·la) el LaunchAgent del host_open_helper amb les rutes
# d'AQUESTA màquina. Portable entre Macs amb usuaris diferents: deriva la ruta
# del helper de la ubicació d'aquest mateix script i usa $HOME per a logs i
# WorkingDirectory. NO hardcoda cap nom d'usuari.
#
# Per què cal: el plist committejat al repo (com.gnosi.host-open-helper.plist)
# porta un usuari concret incrustat i només serveix a la màquina d'aquell
# usuari. En una segona Mac amb un altre usuari, instal·lar-lo tal qual fa que
# launchd no trobi l'script → el helper no arrenca → els enllaços file:// del
# vault no s'obren (el backend, dins Docker, no pot cridar el Finder del host).
#
# Ús:
#   sh install_launchagent.sh            # instal·la i verifica
#   GNOSI_HOST_OPEN_PORT=5099 sh ...     # override del port (opcional)
#
# Idempotent: si ja està carregat, fa bootout + bootstrap (recarrega net).
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER_PY="$SCRIPT_DIR/host_open_helper.py"
LABEL="com.gnosi.host-open-helper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGDIR="$HOME/Library/Logs/Gnosi"
PORT="${GNOSI_HOST_OPEN_PORT:-5099}"
PYTHON="$(command -v python3 || echo /usr/bin/python3)"

if [ ! -f "$HELPER_PY" ]; then
    echo "ERROR: no trobo el helper a $HELPER_PY" >&2
    exit 1
fi

mkdir -p "$LOGDIR" "$(dirname "$PLIST")"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>$PYTHON</string>
        <string>$HELPER_PY</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>GNOSI_HOST_OPEN_PORT</key>
        <string>$PORT</string>
        <key>GNOSI_OPEN_ROOTS</key>
        <string></string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$LOGDIR/host-open-helper.log</string>

    <key>StandardErrorPath</key>
    <string>$LOGDIR/host-open-helper.err</string>

    <key>WorkingDirectory</key>
    <string>$HOME</string>
</dict>
</plist>
EOF

echo "✅ plist escrit a $PLIST (python=$PYTHON, helper=$HELPER_PY)"

GUI="gui/$(id -u)"
# bootout previ (idempotent): si no està carregat, ignora l'error.
launchctl bootout "$GUI/$LABEL" 2>/dev/null || true
launchctl bootstrap "$GUI" "$PLIST"
launchctl kickstart -k "$GUI/$LABEL"

# Petita espera perquè el servidor lligui el port abans de verificar.
i=0
while [ "$i" -lt 10 ]; do
    if curl -sS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
        echo "✅ helper viu a 127.0.0.1:$PORT"
        curl -sS "http://127.0.0.1:$PORT/healthz"
        echo ""
        exit 0
    fi
    i=$((i + 1))
    sleep 1
done

echo "⚠️  el helper no respon a 127.0.0.1:$PORT després de 10s. Mira els logs:" >&2
echo "    tail -20 $LOGDIR/host-open-helper.err" >&2
exit 1
