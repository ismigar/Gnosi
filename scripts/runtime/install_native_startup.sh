#!/usr/bin/env bash
# Instal·la (o reinstal·la) els LaunchAgents que arrenquen Gnosi NATIU a l'inici
# de sessió: backend (uvicorn :5002) + frontend (vite :5173). Substitueix el
# flux Docker. L'usuari el llança explícitament des de l'arrel del repositori.
set -euo pipefail

BASE="$(cd "$(dirname "$0")/../.." && pwd)"           # Gnosi
LA="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/Gnosi"
PATH_ENV="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
mkdir -p "$LA" "$LOGS"

write_plist() {
  local label="$1"; shift
  local plist="$LA/$label.plist"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key>
    <array>$(for a in "$@"; do printf '<string>%s</string>' "$a"; done)</array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>$PATH_ENV</string>
        <key>VITE_BACKEND_HOST</key><string>localhost</string>
        <key>VITE_BACKEND_PORT</key><string>5002</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ThrottleInterval</key><integer>15</integer>
    <key>StandardOutPath</key><string>$LOGS/${label#com.gnosi.}.log</string>
    <key>StandardErrorPath</key><string>$LOGS/${label#com.gnosi.}.err</string>
    <key>WorkingDirectory</key><string>$BASE</string>
</dict>
</plist>
EOF
  echo "  ✅ $plist"
}

echo "🔧 Generant LaunchAgents natius..."
write_plist "com.gnosi.backend-native"  /bin/bash "$BASE/scripts/runtime/run_native_dev.sh" 5002
write_plist "com.gnosi.frontend-native" /bin/bash "$BASE/scripts/runtime/run_native_frontend.sh"

echo "🛑 Aturant processos natius actuals (els re-arrencarà launchd)..."
lsof -ti :5002 2>/dev/null | xargs kill 2>/dev/null || true
lsof -ti :5173 2>/dev/null | xargs kill 2>/dev/null || true
sleep 2

echo "🚀 Carregant serveis..."
for label in com.gnosi.backend-native com.gnosi.frontend-native; do
  launchctl unload "$LA/$label.plist" 2>/dev/null || true
  launchctl load "$LA/$label.plist"
done

echo "✅ Fet. Estat:"
launchctl list | grep -i "gnosi.*native" || true
echo "Backend i frontend arrencaran automàticament a cada inici de sessió."
