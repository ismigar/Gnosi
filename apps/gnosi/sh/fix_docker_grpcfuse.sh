#!/usr/bin/env bash
# fix_docker_grpcfuse.sh — Posa Docker Desktop a «gRPC FUSE» (no VirtioFS).
#
# Amb VirtioFS, llegir el vault servit pel File Provider de OneDrive des de dins
# el contenidor provoca `OSError: [Errno 35] Resource deadlock avoided` (EDEADLK):
# el backend (gnosi_backend) entra en bucle de reinici → «no carrega cap pàgina
# ni BD». Amb gRPC FUSE el deadlock desapareix.
#
# El canvi és LOCAL de cada Mac (viu a settings-store.json de Docker Desktop, fora
# del repo): un `git pull` NO el propaga, cal executar-lo un cop a cada màquina.
# Idempotent: si ja és gRPC FUSE, surt sense fer res.
#
# Detall: docs/dev_memory/directives/environment_integrity.md
#         → «Fix d'amfitrió: VirtioFS → gRPC FUSE».
set -euo pipefail

readonly TARGET="gRPC FUSE"
readonly SETTINGS="$HOME/Library/Group Containers/group.com.docker/settings-store.json"

DOCKER="${DOCKER_BIN:-/Applications/Docker.app/Contents/Resources/bin/docker}"
command -v "$DOCKER" >/dev/null 2>&1 || DOCKER="docker"

log()  { printf '▶ %s\n' "$*"; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "Aquest script només té sentit a macOS."
command -v "$DOCKER" >/dev/null 2>&1 || die "No trobo el binari 'docker'."
command -v python3 >/dev/null 2>&1 || die "Cal python3 (ve amb macOS)."

# Llegeix la clau actual de forma robusta (fitxer absent / JSON corrupte).
read_impl() {
  python3 - "$SETTINGS" <<'PY'
import json, sys, pathlib
p = pathlib.Path(sys.argv[1])
if not p.exists():
    print("__MISSING__"); raise SystemExit
try:
    d = json.loads(p.read_text() or "{}")
except Exception:
    print("__BADJSON__"); raise SystemExit
print(d.get("fileSharingImplementation", "__UNSET__"))
PY
}

current="$(read_impl)"
case "$current" in
  __MISSING__) die "No existeix $SETTINGS. Arrenca Docker Desktop un cop i reprova.";;
  __BADJSON__) die "settings-store.json no és JSON vàlid. Revisa'l a mà.";;
  "$TARGET")   log "Ja està a «$TARGET». Res a fer."; exit 0;;
  __UNSET__)   log "Actual: (no definit → VirtioFS per defecte). Canvio a «$TARGET».";;
  *)           log "Actual: «$current». Canvio a «$TARGET».";;
esac

# Backup (sufix PID; sense data perquè new Date() no és fiable en aquest entorn).
cp "$SETTINGS" "${SETTINGS}.bak.$$"
log "Backup: ${SETTINGS}.bak.$$"

# Aturar Docker DEL TOT: el GUI reescriu els settings en sortir si segueix viu.
log "Aturant Docker…"
"$DOCKER" desktop stop >/dev/null 2>&1 || true
osascript -e 'quit app "Docker Desktop"' >/dev/null 2>&1 || true
for _ in $(seq 1 30); do "$DOCKER" ps >/dev/null 2>&1 || break; sleep 2; done
for _ in $(seq 1 15); do
  pgrep -f 'Docker Desktop.app/Contents/MacOS/Docker Desktop' >/dev/null 2>&1 || break
  sleep 1
done

# Editar el JSON preservant la resta de claus.
python3 - "$SETTINGS" "$TARGET" <<'PY'
import json, sys, pathlib
p = pathlib.Path(sys.argv[1])
d = json.loads(p.read_text() or "{}")
d["fileSharingImplementation"] = sys.argv[2]
p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
PY
log "settings-store.json → «$TARGET»."

# Reobrir i esperar el dimoni.
log "Reobrint Docker…"
open -a Docker 2>/dev/null || open -a "Docker Desktop" 2>/dev/null || die "No he pogut obrir Docker."
up=0
for i in $(seq 1 60); do
  if "$DOCKER" ps >/dev/null 2>&1; then up=1; log "Dimoni amunt (~$((i*3))s)."; break; fi
  sleep 3
done
[ "$up" = 1 ] || die "El dimoni no respon després de ~180s. Revisa Docker Desktop."

# Read-back de confirmació.
final="$(read_impl)"
[ "$final" = "$TARGET" ] || die "Read-back inesperat: «$final». Docker ho pot haver revertit."
log "Confirmat: fileSharingImplementation = «$final»."
log "El backend (restart: unless-stopped) arrenca sol (~1 min)."
log "Comprova: curl -s http://127.0.0.1:5002/api/health"
