#!/usr/bin/env bash
#
# install_warmup_loginitem.sh — Instal·la el OneDrive warmup daemon com a
# LOGIN ITEM (sessió gràfica), substituint el LaunchAgent.
#
# PER QUÈ (provat 2026-06-06, sessió tender-shtern)
#   macOS NO deixa que un procés de FONS materialitzi fitxers online-only de
#   OneDrive (File Provider de tercers): el LaunchAgent `com.gnosi.onedrive-warmup`,
#   fins i tot a `gui/$UID`, rep EDEADLK (errno 11) en `read()` i timeout a
#   `qlmanage`. El MATEIX daemon, arrencat des d'una SESSIÓ GRÀFICA (Terminal o
#   Login Item), materialitza sense problema (provat: instància a 5010 →
#   {"status":"materialized"}). Per tant cal Login Item, NO LaunchAgent.
#
#   No és FDA (l'errno és 11, no 1) ni el bundle `.app` adhoc-signat (antipatró
#   de FDA inestable): el llançador `.app` NO llegeix fitxers, només fa `exec`
#   de `/usr/bin/python3` (que ha de tenir Full Disk Access, com sempre).
#
# REQUISIT (un cop): /usr/bin/python3 amb Full Disk Access
#   Settings → Privacy & Security → Full Disk Access → afegir /usr/bin/python3.
#
# Després d'executar-lo: pot saltar Gatekeeper la 1a obertura de l'app (aprova-la)
# i un permís d'Automatització per afegir el Login Item (accepta'l).
set -euo pipefail

readonly LABEL_OLD="com.gnosi.onedrive-warmup"
readonly APP="$HOME/Applications/GnosiOneDriveWarmup.app"
readonly PORT="${ONEDRIVE_WARMUP_PORT:-5009}"

log() { printf '▶ %s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }
[ "$(uname -s)" = "Darwin" ] || die "Només macOS."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DAEMON="$SCRIPT_DIR/onedrive_warmup_daemon.py"
[ -f "$DAEMON" ] || die "No trobo el daemon a $DAEMON"
ROOTS="${ONEDRIVE_WARMUP_ALLOWED_ROOTS:-$HOME/Library/CloudStorage/OneDrive-UNED}"

# 1) Atura el LaunchAgent antic (context de fons; no pot materialitzar) i orfes.
log "Aturant el LaunchAgent antic ($LABEL_OLD)…"
launchctl bootout "gui/$(id -u)/$LABEL_OLD" 2>/dev/null \
  || launchctl unload "$HOME/Library/LaunchAgents/$LABEL_OLD.plist" 2>/dev/null || true
pkill -f onedrive_warmup_daemon.py 2>/dev/null || true

# 2) Crea la .app llançadora. `exec python3 daemon` → el daemon ÉS el procés de
#    l'app (en sessió gràfica) i hi roman viu.
log "Creant $APP…"
mkdir -p "$APP/Contents/MacOS"
cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>GnosiOneDriveWarmup</string>
  <key>CFBundleIdentifier</key><string>com.gnosi.warmup-loginitem</string>
  <key>CFBundleExecutable</key><string>warmup</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
EOF
cat > "$APP/Contents/MacOS/warmup" <<EOF
#!/bin/bash
export ONEDRIVE_WARMUP_ALLOWED_ROOTS="$ROOTS"
export ONEDRIVE_WARMUP_PORT="$PORT"
export ONEDRIVE_WARMUP_BIND="0.0.0.0"
export ONEDRIVE_WARMUP_TIMEOUT="90"
exec /usr/bin/python3 "$DAEMON"
EOF
chmod +x "$APP/Contents/MacOS/warmup"

# 3) Registra com a Login Item (arrenca a cada login, en sessió gràfica).
log "Afegint a Login Items…"
osascript -e "tell application \"System Events\" to delete (every login item whose name is \"GnosiOneDriveWarmup\")" 2>/dev/null || true
osascript -e "tell application \"System Events\" to make login item at end with properties {path:\"$APP\", hidden:true}" 2>/dev/null \
  || log "AVÍS: no he pogut afegir el Login Item automàticament; afegeix $APP manualment a Settings → General → Login Items."

# 4) Arrenca-la ARA (sessió gràfica) perquè funcioni sense esperar al re-login.
log "Arrencant $APP…"
open "$APP" || die "No he pogut obrir l'app (Gatekeeper?)."

# 5) Verifica.
ok=0
for _ in $(seq 1 15); do
  if curl -s --max-time 3 "http://localhost:$PORT/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[ "$ok" = 1 ] || die "El daemon no respon al $PORT. Mira la Consola per Gatekeeper/permisos."
log "✅ Warmup (Login Item) viu al $PORT. Materialitza des de la sessió gràfica."
log "   Verifica que materialitza: obre una taula amb imatges online-only."
