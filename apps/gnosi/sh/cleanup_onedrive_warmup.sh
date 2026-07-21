#!/usr/bin/env bash
# Elimina el daemon de warmup de OneDrive, innecessari amb el runtime NATIU
# (el warmup hidratava fitxers de OneDrive per a Docker; natiu llegeix al host
# i hidrata sol). L'usuari l'executa explícitament.
echo "🛑 Aturant el procés de warmup..."
pkill -f "GnosiOneDriveWarmup" 2>/dev/null && echo "  ✅ procés aturat" || echo "  (no corria)"

echo "🗑️  Traient-lo dels Elements d'inici (Login Items)..."
osascript -e 'tell application "System Events" to delete login item "GnosiOneDriveWarmup"' 2>/dev/null \
  && echo "  ✅ LoginItem tret" \
  || echo "  ⚠️ no s'ha pogut per AppleScript: treu-lo a mà a Configuració → General → Elements d'inici"

echo "🗑️  Eliminant l'app i el plist residual..."
rm -rf "$HOME/Applications/GnosiOneDriveWarmup.app" 2>/dev/null && echo "  ✅ app eliminada" || echo "  (app no trobada a ~/Applications)"
rm -f "$HOME/Library/LaunchAgents/com.gnosi.onedrive-warmup.plist.disabled-by-loginitem" 2>/dev/null && echo "  ✅ plist residual eliminat"

echo "✅ Fet. El warmup de OneDrive ja no s'iniciarà."
