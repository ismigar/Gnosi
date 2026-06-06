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
#   El context (EDEADLK, errno 11) es resol arrencant-lo des de la SESSIÓ GRÀFICA.
#   PERÒ com a Login Item el RESPONSABLE TCC passa a ser la pròpia `.app` (no
#   `/usr/bin/python3`): és la `.app` qui necessita Full Disk Access (provat:
#   sense FDA a la .app → warmups errno 1 / EPERM; amb FDA → materialitza).
#
# REQUISIT (un cop): GnosiOneDriveWarmup.app amb Full Disk Access
#   Settings → Privacy & Security → Full Disk Access → `+` →
#   ~/Applications/GnosiOneDriveWarmup.app. Després reinicia l'app (quit + reobre,
#   o re-executa l'script). Aquest script és IDEMPOTENT: NO recrea la .app si ja
#   existeix (recrear-la invalidaria el FDA) — usa `--force` per recrear-la.
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

# 1) Desactiva PERMANENTMENT el LaunchAgent antic (context de fons; no pot
#    materialitzar). Cal renombrar el plist: si no, RunAtLoad el rellançaria al
#    proper login i xocaria amb la nostra app al port 5009. NO fem un pkill ampli
#    del daemon aquí: mataria el de la NOSTRA app si ja corre.
PLIST_OLD="$HOME/Library/LaunchAgents/$LABEL_OLD.plist"
log "Desactivant el LaunchAgent antic ($LABEL_OLD)..."
launchctl bootout "gui/$(id -u)/$LABEL_OLD" 2>/dev/null \
  || launchctl unload "$PLIST_OLD" 2>/dev/null || true
[ -f "$PLIST_OLD" ] && mv -f "$PLIST_OLD" "$PLIST_OLD.disabled-by-loginitem" 2>/dev/null || true

# 2) Crea l'app amb osacompile (app AppleScript de DEBÒ: runtime `applet`
#    reconegut pel sistema → TCC pot concedir-li Full Disk Access NET, cosa que
#    una .app feta a mà amb executable de script NO aconsegueix —"login item
#    UNKNOWN" + warmup errno 1 fins i tot amb FDA). El `do shell script ... exec
#    python3` manté el daemon com a fill viu d'aquesta app (procés RESPONSABLE
#    per TCC) en sessió gràfica. IDEMPOTENT: no recrear (preserva el FDA) tret de
#    `--force`.
if [ -d "$APP" ] && [ "${1:-}" != "--force" ]; then
  log "L'app ja existeix; la conservo (preservo el seu FDA). Usa --force per recrear-la."
else
  log "Creant ${APP} (osacompile)..."
  rm -rf "$APP"
  ASTMP="$(mktemp -d)"
  cat > "$ASTMP/warmup.applescript" <<EOF
-- Llançador del OneDrive warmup daemon. Concedeix Full Disk Access a AQUESTA app
-- (System Settings > Privacy & Security > Full Disk Access).
do shell script "ONEDRIVE_WARMUP_ALLOWED_ROOTS='${ROOTS}' ONEDRIVE_WARMUP_PORT='${PORT}' ONEDRIVE_WARMUP_BIND='0.0.0.0' ONEDRIVE_WARMUP_TIMEOUT='90' exec /usr/bin/python3 '${DAEMON}'"
EOF
  osacompile -o "$APP" "$ASTMP/warmup.applescript" || die "osacompile ha fallat."
  rm -rf "$ASTMP"
  # Sense icona al Dock + nom de bundle (perquè es reconegui bé, no "UNKNOWN").
  /usr/bin/plutil -replace LSUIElement -bool true "$APP/Contents/Info.plist" 2>/dev/null \
    || /usr/bin/plutil -insert LSUIElement -bool true "$APP/Contents/Info.plist" 2>/dev/null || true
  /usr/bin/plutil -replace CFBundleName -string "GnosiOneDriveWarmup" "$APP/Contents/Info.plist" 2>/dev/null || true
  # Identitat estable per a TCC (NO és l'antipatró: és un llançador estable, no
  # conté el daemon → cdhash no canvia quan s'actualitza el codi del daemon).
  if codesign --force --deep --sign - "$APP" 2>/dev/null; then
    log "Signada (ad-hoc)."
  else
    log "AVÍS: no he pogut signar amb codesign."
  fi
fi

# 3) Registra com a Login Item (arrenca a cada login, en sessió gràfica).
log "Afegint a Login Items..."
osascript -e "tell application \"System Events\" to delete (every login item whose name is \"GnosiOneDriveWarmup\")" 2>/dev/null || true
osascript -e "tell application \"System Events\" to make login item at end with properties {path:\"$APP\", hidden:true}" 2>/dev/null \
  || log "AVÍS: no he pogut afegir el Login Item automàticament; afegeix $APP manualment a Settings → General → Login Items."

# 4) Arrenca l'app si no està servint ja. TCC avalua el FDA per-accés → NO cal
#    reiniciar després de concedir el FDA. Si ja corre i respon, NO la toquem
#    (reiniciar mataria un daemon que ja funciona). Si no, neteja restes i obre.
if pgrep -f "GnosiOneDriveWarmup.app/Contents" >/dev/null 2>&1 \
   && curl -s --max-time 2 "http://localhost:$PORT/healthz" >/dev/null 2>&1; then
  log "L'app ja corre i respon al $PORT; la conservo."
else
  log "Arrencant $APP..."
  pkill -f "GnosiOneDriveWarmup.app/Contents" 2>/dev/null || true  # applet en mal estat
  pkill -f onedrive_warmup_daemon.py 2>/dev/null || true
  sleep 1
  open "$APP" || die "No he pogut obrir l'app (Gatekeeper?)."
fi

# 5) Verifica.
ok=0
for _ in $(seq 1 15); do
  if curl -s --max-time 3 "http://localhost:$PORT/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[ "$ok" = 1 ] || die "El daemon no respon al $PORT. Mira la Consola per Gatekeeper/permisos."
log "✅ Warmup (Login Item) viu al $PORT."

# 6) Auto-diagnòstic: materialitza un fitxer dataless real. errno 1 = falta FDA.
log "Verificant materialitzacio..."
TESTF=$(/usr/bin/python3 - "$ROOTS" <<'PY' 2>/dev/null || true
import os, sys
for dp, _, fns in os.walk(sys.argv[1]):
    for fn in fns:
        if fn.startswith('.'):
            continue
        p = os.path.join(dp, fn)
        try:
            s = os.stat(p)
            if 0 < s.st_size < 300000 and s.st_blocks == 0:
                print(p); sys.exit()
        except OSError:
            pass
PY
)
if [ -n "${TESTF:-}" ]; then
  enc=$(/usr/bin/python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$TESTF")
  resp=$(curl -s --max-time 30 "http://localhost:$PORT/warmup?path=$enc" || true)
  case "$resp" in
    *materialized*)
      log "OK Materialitzacio VERIFICADA -- tot el cami funciona." ;;
    *'"errno": 1'*)
      printf '\n>>> Warmup errno 1 = FALTA Full Disk Access a la .app.\n>>> Settings > Privacy & Security > Full Disk Access > [+] > %s\n>>> Despres: reinicia la .app (quit + reobre) o re-executa aquest script.\n\n' "$APP" ;;
    *)
      log "Resposta de prova: $resp" ;;
  esac
else
  log "Sense fitxers dataless per provar ara; obre una taula amb imatges online-only per verificar."
fi
