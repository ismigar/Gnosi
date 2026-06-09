#!/bin/sh
# docker_watchdog.sh — reaixeca Docker Desktop quan es penja.
#
# Problema que resol: al Mac Intel 2014 amb el vault a OneDrive, la VM de
# Docker Desktop es penja de tant en tant (procés "Docker Desktop" VIU però
# daemon/VM mort: `docker ps` es penja o dóna 500, i tot Gnosi cau a 000).
# El `gnosi_boot.sh` NO ho detecta perquè només mira `pgrep "Docker Desktop"`
# (que segueix viu) i a més només corre cada 6 h.
#
# Aquest watchdog (LaunchAgent amb StartInterval curt, ~3 min) comprova la
# salut REAL i, si el daemon està penjat, fa kill -9 + `open -a Docker`
# (els contenidors tenen restart: unless-stopped → tornen sols).
#
# Disseny anti-bucle / anti-interferència:
#   - Camí ràpid: si el backend respon, surt immediatament (cas normal).
#   - Només actua si el procés és VIU però el DAEMON no respon (= penjat),
#     mai si Docker està parat del tot (això ho gestionen el boot/usuari).
#   - Si el daemon respon però el backend no respon ni 10s després (event loop
#     penjat per una recàrrega de --reload), fa `docker restart gnosi_backend`
#     (amb cooldown). Una recàrrega normal (uns segons) s'auto-recupera i no s'hi toca.
#   - Cooldown via stamp file: no reinicia si ja ho ha fet fa <COOLDOWN s
#     (Docker triga ~90 s a estar healthy).
#   - Timeout casolà a `docker info` (macOS no té `timeout`) perquè el propi
#     watchdog no es pengi com el CLI.
set -u
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

LOG="$HOME/.gnosi_docker_watchdog.log"
STAMP="$HOME/.gnosi_docker_watchdog.laststart"
COOLDOWN="${GNOSI_WATCHDOG_COOLDOWN:-300}"   # s; Docker arrenca ~90s, marge ampli
HEALTH_URL="${GNOSI_HEALTH_URL:-http://localhost:5002/api/health}"
DAEMON_TIMEOUT=8                              # s d'espera màxima a `docker info`

ts() { date "+%Y-%m-%d %H:%M:%S"; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

# Rotació simple del log (~256 KB).
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 262144 ]; then
  : > "$LOG"
fi

# 0) host_open_helper (cerca Spotlight del picker "Seleccionar fitxer o carpeta").
#    És un dimoni de llarga durada que perd l'accés a ~/Library/CloudStorage
#    (OneDrive) al cap d'UNES HORES: el File Provider d'OneDrive es ranceja per
#    al procés vell i `mdfind -onlyin <CloudStorage>` torna BUIT, tot i que la
#    resta del disc (Containers, etc.) encara es veu. Símptoma: la cerca del
#    picker "no troba" fitxers del Vault (p.ex. "Ética de Kant"). Un kickstart
#    reconnecta el File Provider i ho arregla a l'instant (verificat).
#    Sentinella: "OneDrive" DINS ~/Library/CloudStorage (casa el nom del
#    proveïdor "OneDrive-UNED"; independent del contingut del Vault). COMPTE: un
#    terme genèric a HOME (p.ex. "Documents") NO serveix com a sentinella — casa
#    a ~/Library/Containers i tornaria resultats encara amb CloudStorage caigut,
#    amagant el fallu. Si el helper RESPON però amb 0 resultats aquí → encallat
#    → kickstart. Independent del backend (va ABANS del camí ràpid de Docker);
#    cooldown propi → mai entra en bucle; si no respon, no hi toquem (KeepAlive).
CLOUDSTORAGE="$HOME/Library/CloudStorage"
HELPER_STAMP="$HOME/.gnosi_host_helper_restart.laststart"
HELPER_COOLDOWN="${GNOSI_HELPER_COOLDOWN:-600}"   # s; marge ampli, no cal reiniciar sovint
if [ -d "$CLOUDSTORAGE" ]; then
  helper_resp=$(curl -s --max-time 8 -X POST "http://127.0.0.1:5099/search" \
    -H 'Content-Type: application/json' \
    -d "{\"query\":\"OneDrive\",\"limit\":1,\"roots\":[\"$CLOUDSTORAGE\"]}" 2>/dev/null)
  case "$helper_resp" in
    *'"path"'*)
      : ;;                                          # veu CloudStorage → sa
    *'"results"'*)                                  # resposta vàlida però sense cap "path" → CloudStorage caigut
      hnow=$(date +%s); hlast=0
      [ -f "$HELPER_STAMP" ] && hlast=$(cat "$HELPER_STAMP" 2>/dev/null || echo 0)
      case "$hlast" in ''|*[!0-9]*) hlast=0 ;; esac
      if [ "$((hnow - hlast))" -ge "$HELPER_COOLDOWN" ]; then
        log "host_open_helper sense accés a CloudStorage (sentinella 'OneDrive' buit) → kickstart."
        launchctl kickstart -k "gui/$(id -u)/com.gnosi.host-open-helper" 2>/dev/null
        echo "$hnow" > "$HELPER_STAMP"
      else
        log "host_open_helper sembla encallat però reiniciat fa $((hnow - hlast))s (<${HELPER_COOLDOWN}s); espero."
      fi
      ;;
    *)
      : ;;                                          # buit / no respon → KeepAlive ja se n'ocupa
  esac
fi

# 1) Camí ràpid: el backend respon → tot OK, no fem res (sense soroll al log).
if curl -s -o /dev/null --max-time 6 "$HEALTH_URL" 2>/dev/null; then
  exit 0
fi

# 2) Backend no respon. Docker Desktop està obert?
if ! pgrep -f "Docker Desktop" >/dev/null 2>&1; then
  log "Docker Desktop parat (procés absent). El watchdog no actua (ho gestiona boot/usuari)."
  exit 0
fi

# 3) Procés viu però backend no respon. Respon el daemon? (timeout casolà)
docker info >/dev/null 2>&1 &
DPID=$!
i=0
while kill -0 "$DPID" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge "$DAEMON_TIMEOUT" ]; then
    kill -9 "$DPID" 2>/dev/null
    break
  fi
  sleep 1
done
wait "$DPID" 2>/dev/null
DAEMON_RC=$?

if [ "$DAEMON_RC" -eq 0 ]; then
  # Daemon viu però el backend NO respon. Cal distingir:
  #   - Recàrrega/arrencada normal (uns segons) → s'auto-recupera, no toquem res.
  #   - PENJAT: l'event loop es bloqueja després d'una recàrrega de `--reload`
  #     (el worker no mor amb el SIGTERM i el supervisor no n'arrenca cap de nou)
  #     → NO s'auto-recupera mai. Cal `docker restart gnosi_backend`.
  # Re-comprovem després d'una espera curta: si era normal, ja haurà tornat.
  sleep 10
  if curl -s -o /dev/null --max-time 6 "$HEALTH_URL" 2>/dev/null; then
    exit 0
  fi
  BSTAMP="$HOME/.gnosi_backend_restart.laststart"
  BCOOLDOWN="${GNOSI_BACKEND_COOLDOWN:-90}"   # anti-flapping del backend
  bnow=$(date +%s); blast=0
  [ -f "$BSTAMP" ] && blast=$(cat "$BSTAMP" 2>/dev/null || echo 0)
  case "$blast" in ''|*[!0-9]*) blast=0 ;; esac
  if [ "$((bnow - blast))" -lt "$BCOOLDOWN" ]; then
    log "backend no respon però reiniciat fa $((bnow - blast))s (<${BCOOLDOWN}s); espero."
    exit 0
  fi
  log "BACKEND PENJAT (daemon viu, /api/health KO després de 10s) → docker restart gnosi_backend."
  echo "$bnow" > "$BSTAMP"
  docker restart gnosi_backend >/dev/null 2>&1 && log "backend reiniciat." || log "docker restart gnosi_backend ha fallat."
  exit 0
fi

# 4) Daemon penjat. Anti-flapping: hem reiniciat fa poc?
now=$(date +%s)
if [ -f "$STAMP" ]; then
  last=$(cat "$STAMP" 2>/dev/null || echo 0)
  case "$last" in
    ''|*[!0-9]*) last=0 ;;
  esac
  if [ "$((now - last))" -lt "$COOLDOWN" ]; then
    log "daemon penjat però reiniciat fa $((now - last))s (<${COOLDOWN}s); espero que arrenqui."
    exit 0
  fi
fi

log "DAEMON PENJAT detectat → reiniciant Docker (kill -9 + open -a Docker)."
pkill -9 -f "Docker Desktop" 2>/dev/null
pkill -9 -f "com.docker.backend" 2>/dev/null
pkill -9 -f "com.docker.virtualization" 2>/dev/null
pkill -9 -f "com.docker.build" 2>/dev/null
sleep 3
open -a Docker
echo "$now" > "$STAMP"
log "Docker reiniciat. Els contenidors tornen sols (restart: unless-stopped); ~90s fins healthy."
exit 0
