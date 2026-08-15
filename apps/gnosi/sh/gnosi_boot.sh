#!/bin/zsh
# Gnosi boot orchestrator (host-side).
#
# Executat per ~/Library/LaunchAgents/com.gnosi.boot.plist:
#   - RunAtLoad        -> en iniciar sessió
#   - StartInterval    -> cada 6 h (manté el vault "calent" i Docker viu)
#
# Resol el patró recurrent "torno passades setmanes i Logs/Historial/
# Planificador surten buits":
#   1) OneDrive desmaterialitza el vault (online-only) durant les setmanes
#      sense ús -> el backend troba .gnosi/params.yaml i scheduler_config.json
#      dataless en arrencar. Aquí els re-materialitzem ABANS d'obrir Docker.
#   2) Docker Desktop no s'arrenca sol de manera fiable -> el backend (que
#      té restart: unless-stopped) no corre i tot surt buit. Aquí l'obrim.
#
# Idempotent: els fitxers ja materialitzats (st_blocks>0) se salten; obrir
# Docker quan ja corre és un no-op.
set -u

# Vault ACTIU (no l'arrel …/Gnosi: des del multi-vault és el CONTENIDOR de
# vaults — Principal/, Notion/, … — i .gnosi/ i BD/ viuen DINS de cada vault).
VAULT="${GNOSI_VAULT:-$HOME/Library/CloudStorage/OneDrive-UNED/Gnosi/Principal}"
LOG="$HOME/.gnosi_boot.log"
DOCKER_APP="/Applications/Docker.app"

ts() { date "+%Y-%m-%d %H:%M:%S"; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

# Rotació simple: si el log supera ~256 KB, el reiniciem.
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 262144 ]; then
  : > "$LOG"
fi
log "=== gnosi_boot start (vault=$VAULT) ==="

# Materialitza tots els fitxers d'un directori del vault forçant una lectura
# real de bytes (neteja el flag dataless del File Provider de OneDrive).
# $1=dir  $2=etiqueta  $3=màx fitxers
materialize() {
  local dir="$1" label="$2" maxfiles="$3"
  if [ ! -d "$dir" ]; then
    log "$label: directori inexistent ($dir)"
    return
  fi
  python3 - "$dir" "$LOG" "$label" "$maxfiles" <<'PY'
import os, sys, signal
d, logp, label, maxfiles = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
def w(m):
    with open(logp, "a") as f: f.write(m + "\n")
def on_to(*a): raise TimeoutError("timeout")
signal.signal(signal.SIGALRM, on_to)

files = []
for root, _, fs in os.walk(d):
    for fn in fs:
        files.append(os.path.join(root, fn))
        if len(files) >= maxfiles: break
    if len(files) >= maxfiles: break

ok = skip = fail = 0
for p in files:
    try:
        if os.stat(p).st_blocks > 0:  # ja materialitzat
            skip += 1
            continue
    except Exception:
        pass
    done = False
    for _ in range(2):  # OneDrive sovint respon al 2n intent
        try:
            signal.alarm(30)
            with open(p, "rb") as f:
                f.read()
            signal.alarm(0)
            ok += 1
            done = True
            break
        except Exception:
            signal.alarm(0)
    if not done:
        fail += 1
w(f"  {label}: ok={ok} skip(ja materialitzats)={skip} fail={fail} total={len(files)}")
PY
}

# --- 1) .gnosi/ : crític i petit -> síncron i ABANS d'obrir Docker ---
log "materialitzant .gnosi/ (crític per l'arrencada del backend)..."
materialize "$VAULT/.gnosi" ".gnosi" 500

# --- 2) Assegurar Docker Desktop obert (backend = restart: unless-stopped) ---
if [ -d "$DOCKER_APP" ]; then
  if pgrep -f "Docker Desktop" >/dev/null 2>&1; then
    log "Docker ja està obert"
  else
    log "obrint Docker Desktop..."
    open -a Docker
  fi
else
  log "AVÍS: Docker.app no trobat a $DOCKER_APP"
fi

# --- 3) BD/ : gran -> SÍNCRON. NO en segon pla amb '&': launchd mata el
# process group quan el job principal retorna, deixant BD a mig materialitzar
# (bug observat: el warmup de BD no s'acabava mai via LaunchAgent). Síncron, el
# job dura més però no bloqueja l'usuari (corre en background del sistema).
log "materialitzant BD/ (síncron)..."
materialize "$VAULT/BD" "BD" 8000

log "=== gnosi_boot fi ==="
