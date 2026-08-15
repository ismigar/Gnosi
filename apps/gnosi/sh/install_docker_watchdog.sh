#!/bin/sh
# Instal·la (o reinstal·la) el LaunchAgent del docker_watchdog amb les rutes
# d'AQUESTA màquina. Portable entre Macs (deriva la ruta de l'script de la
# ubicació d'aquest instal·lador i usa $HOME; NO hardcoda cap usuari).
#
# El watchdog corre cada StartInterval segons i reaixeca Docker si el detecta
# penjat. Vegeu docker_watchdog.sh.
#
# Ús:
#   sh install_docker_watchdog.sh
#   GNOSI_WATCHDOG_INTERVAL=180 sh install_docker_watchdog.sh   # override interval
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WATCHDOG_SH="$SCRIPT_DIR/docker_watchdog.sh"
LABEL="com.gnosi.docker-watchdog"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
INTERVAL="${GNOSI_WATCHDOG_INTERVAL:-180}"   # s entre comprovacions

if [ ! -f "$WATCHDOG_SH" ]; then
    echo "ERROR: no trobo el watchdog a $WATCHDOG_SH" >&2
    exit 1
fi
chmod +x "$WATCHDOG_SH" 2>/dev/null || true
mkdir -p "$(dirname "$PLIST")"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/sh</string>
        <string>$WATCHDOG_SH</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>StartInterval</key>
    <integer>$INTERVAL</integer>

    <key>StandardOutPath</key>
    <string>/tmp/gnosi-docker-watchdog.out</string>

    <key>StandardErrorPath</key>
    <string>/tmp/gnosi-docker-watchdog.err</string>
</dict>
</plist>
EOF

echo "✅ plist escrit a $PLIST (watchdog=$WATCHDOG_SH, interval=${INTERVAL}s)"

GUI="gui/$(id -u)"
launchctl bootout "$GUI/$LABEL" 2>/dev/null || true
launchctl bootstrap "$GUI" "$PLIST"
echo "✅ LaunchAgent $LABEL carregat (s'executa ara i cada ${INTERVAL}s)"
echo "   log: ~/.gnosi_docker_watchdog.log"
