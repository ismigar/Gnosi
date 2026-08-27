#!/usr/bin/env bash
#
# install_warmup_daemon.sh — Instal·la el OneDrive warmup daemon com a
# LaunchAgent perquè arrenqui al login i es reiniciï si mor (KeepAlive).
#
# PER QUÈ
#   El backend de Gnosi corre dins Docker amb un bind-mount al vault d'OneDrive.
#   Els fitxers online-only (`dataless`) no es poden llegir des del contenidor
#   (EDEADLK / Errno 35) fins que el File Provider de macOS els materialitza.
#   Aquest daemon, al host, els materialitza sota demanda (port 5009). Si no
#   corre: les icones surten buides i obrir pàgines dona error de càrrega.
#
#   Arrencar-lo a mà (nohup) NO sobreviu reboot/logout → "torna a passar". Aquest
#   script el fa PERMANENT.
#
# IDEMPOTENT: si ja està instal·lat, recarrega el plist amb la config actual.
#
# REQUISIT MANUAL (un cop): /usr/bin/python3 ha de tenir Full Disk Access:
#   Settings → Privacy & Security → Full Disk Access → afegir /usr/bin/python3.
#   (Sense FDA, el daemon arrenca però els warmups donen errno 1 / EPERM.)
#
# Detall: docs/dev_memory/directives/onedrive_warmup_daemon_setup.md
set -euo pipefail

readonly LABEL="com.gnosi.onedrive-warmup"
readonly PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
readonly PORT="5009"

log()  { printf '▶ %s\n' "$*"; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "Només macOS."

# Path absolut al daemon (aquest script viu a scripts/runtime/).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DAEMON="$SCRIPT_DIR/onedrive_warmup_daemon.py"
[ -f "$DAEMON" ] || die "No trobo el daemon a $DAEMON"

# Python del sistema: invocació DIRECTA (no bundle) per mantenir FDA estable —
# vegeu la directiva (antipattern: bundle .app adhoc-signed).
PYTHON="/usr/bin/python3"
[ -x "$PYTHON" ] || die "No trobo $PYTHON"

# Arrels permeses per al warmup. Per defecte tot OneDrive-UNED (vault +
# Biblioteca + Documents enllaçats). Ajusta si el teu CloudStorage difereix.
ROOTS="${ONEDRIVE_WARMUP_ALLOWED_ROOTS:-$HOME/Library/CloudStorage/OneDrive-UNED}"
[ -d "$ROOTS" ] || log "AVÍS: $ROOTS no existeix; revisa ONEDRIVE_WARMUP_ALLOWED_ROOTS."

log "Daemon : $DAEMON"
log "Python : $PYTHON"
log "Roots  : $ROOTS"
log "Plist  : $PLIST"

mkdir -p "$(dirname "$PLIST")"

# Generar el plist. RunAtLoad + KeepAlive = arrenca al login i reviu si mor.
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${PYTHON}</string>
        <string>${DAEMON}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>ONEDRIVE_WARMUP_ALLOWED_ROOTS</key>
        <string>${ROOTS}</string>
        <key>ONEDRIVE_WARMUP_PORT</key>
        <string>${PORT}</string>
        <key>ONEDRIVE_WARMUP_BIND</key>
        <string>0.0.0.0</string>
        <key>ONEDRIVE_WARMUP_TIMEOUT</key>
        <string>90</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/onedrive-warmup.out</string>
    <key>StandardErrorPath</key>
    <string>/tmp/onedrive-warmup.err</string>
</dict>
</plist>
PLIST_EOF
log "Plist escrit."

# Matar orfes que podrien retenir el port 5009 abans de recarregar.
pkill -f onedrive_warmup_daemon.py 2>/dev/null || true

# Recàrrega (unload tolera que no estigui carregat).
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST" || die "launchctl load ha fallat."
log "LaunchAgent carregat."

# Verificació: esperar que el port respongui.
ok=0
for _ in $(seq 1 15); do
  if curl -s --max-time 3 "http://localhost:${PORT}/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done

if [ "$ok" = 1 ]; then
  log "✅ Daemon viu:"
  curl -s --max-time 3 "http://localhost:${PORT}/healthz"; echo
else
  die "El daemon no respon al ${PORT} després de 15s. Mira /tmp/onedrive-warmup.err (sovint: falta Full Disk Access a /usr/bin/python3)."
fi

log "Fet. Arrencarà sol a cada login."
