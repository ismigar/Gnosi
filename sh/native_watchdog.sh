#!/bin/sh
# native_watchdog.sh — reaixeca el backend NATIU quan l'event loop es penja i
# neteja workers orfes d'uvicorn --reload.
#
# Problema que resol (2026-06-25): en mode natiu (uvicorn :5002 via LaunchAgent
# com.gnosi.backend-native) hi ha DOS símptomes:
#   1) CONGELACIÓ: el worker queda VIU però amb l'event loop d'asyncio penjat
#      (tota petició → 000, l'app a "Carregant…"). KeepAlive NO ho detecta
#      perquè el PID existeix. Causes vistes: __wait4 (join/wait síncron d'un
#      subprocés damunt el loop), CPU-spin post-recàrrega de --reload, o socket
#      IMAP bloquejant. Cap s'auto-recupera → cal reiniciar el servei.
#   2) FUITA: uvicorn --reload corre un supervisor (reloader) + el worker real
#      com a subprocés `multiprocessing`. A cada reinici/recàrrega el reloader
#      mor però el worker pot quedar ORFE (reparentat a launchd, ppid=1),
#      carregat amb torch i tot el backend → s'acumulen zombis (molta RAM).
#
# Disseny anti-bucle / anti-interferència (mirall del docker_watchdog.sh):
#   - A cada passada NETEJA workers orfes (ppid=1) prou vells (no el worker viu,
#     que té el reloader com a pare; ni un orfe transitori d'una recàrrega).
#   - Camí ràpid: si el backend RESPON (qualsevol codi HTTP), surt.
#   - Si NO respon, ho confirma després d'un GRACE (una arrencada/recàrrega
#     normal ja haurà tornat) i, si segueix mort, fa kickstart -k amb cooldown.
#   - Timeout a curl (--max-time) perquè el propi watchdog no es pengi.
set -u

LOG="$HOME/.gnosi_native_watchdog.log"
STAMP="$HOME/.gnosi_native_watchdog.laststart"
COOLDOWN="${GNOSI_NATIVE_WATCHDOG_COOLDOWN:-150}"   # s; arrencada + reindex amb marge
GRACE="${GNOSI_NATIVE_WATCHDOG_GRACE:-15}"          # s d'espera abans de confirmar mort
ORPHAN_MIN_AGE="${GNOSI_NATIVE_ORPHAN_MIN_AGE:-90}" # s; no toquis orfes més joves (recàrrega en curs)
HEALTH_URL="${GNOSI_NATIVE_HEALTH_URL:-http://127.0.0.1:5002/api/config}"
LABEL="${GNOSI_NATIVE_LABEL:-com.gnosi.backend-native}"
PROBE_TIMEOUT="${GNOSI_NATIVE_PROBE_TIMEOUT:-6}"    # s màx per sondeig

ts() { date "+%Y-%m-%d %H:%M:%S"; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

# Rotació simple del log (~256 KB).
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 262144 ]; then
  : > "$LOG"
fi

# etime (macOS: [[dd-]hh:]mm:ss) → segons.
etime_secs() {
  ps -o etime= -p "$1" 2>/dev/null | tr -d ' ' | awk -F'[-:]' '
    { n=NF; s=$n; if(n>=2)s+=$(n-1)*60; if(n>=3)s+=$(n-2)*3600; if(n>=4)s+=$(n-3)*86400; print s }'
}

# Neteja workers orfes d'uvicorn --reload (subprocés `--multiprocessing-fork`
# amb ppid=1). El worker VIU té el reloader com a pare (ppid≠1) → no s'hi toca.
# Guarda d'edat: ignora orfes joves (poden ser una recàrrega en curs).
reap_orphans() {
  for p in $(pgrep -f "multiprocessing.*--multiprocessing-fork" 2>/dev/null); do
    pp=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
    [ "$pp" = "1" ] || continue
    age=$(etime_secs "$p"); case "$age" in ''|*[!0-9]*) age=0 ;; esac
    if [ "$age" -ge "$ORPHAN_MIN_AGE" ]; then
      kill -9 "$p" 2>/dev/null && log "worker orfe $p (ppid=1, ${age}s) eliminat — fuita d'uvicorn --reload."
    fi
  done
}

# Sondeig: curl surt 0 si el servidor RESPON (encara que sigui 404); surt !=0
# si fa timeout (event loop penjat = sense resposta).
probe() { curl -s -o /dev/null --max-time "$PROBE_TIMEOUT" "$HEALTH_URL" 2>/dev/null; }

# 0) Neteja d'orfes a cada passada (independent de la salut).
reap_orphans

# 1) Camí ràpid: respon → tot OK, no fem res més.
if probe; then
  exit 0
fi

# 2) No respon. Pot ser una arrencada/recàrrega normal en curs. Esperem i
#    reconfirmem: si era normal, ja haurà tornat.
sleep "$GRACE"
if probe; then
  exit 0
fi

# 3) Segueix mort. Anti-flapping: hem reiniciat fa poc?
now=$(date +%s)
if [ -f "$STAMP" ]; then
  last=$(cat "$STAMP" 2>/dev/null || echo 0)
  case "$last" in ''|*[!0-9]*) last=0 ;; esac
  if [ "$((now - last))" -lt "$COOLDOWN" ]; then
    log "backend KO però reiniciat fa $((now - last))s (<${COOLDOWN}s); espero que arrenqui."
    exit 0
  fi
fi

log "BACKEND PENJAT (sense resposta a $HEALTH_URL després de ${GRACE}s) → kickstart -k $LABEL."

# 3a) Mata TOTS els workers `--multiprocessing-fork` (el penjat + orfes): el
#     servei es reiniciarà i en crearà un de net.
for cpid in $(pgrep -f "multiprocessing.*--multiprocessing-fork" 2>/dev/null); do
  kill -9 "$cpid" 2>/dev/null && log "worker $cpid eliminat abans del reinici."
done

# 3b) Reinici dur del servei (SIGKILL + relaunch via launchd).
echo "$now" > "$STAMP"
if launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  log "$LABEL reiniciat (kickstart -k). Reindex del vault ~uns segons fins respondre."
else
  log "ERROR: kickstart -k $LABEL ha fallat (servei carregat? launchctl list | grep gnosi)."
fi
exit 0
