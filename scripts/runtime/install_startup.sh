#!/usr/bin/env bash

# This script creates a LaunchAgent to start the Gnosi automatically at login.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLIST_PATH="$HOME/Library/LaunchAgents/com.ismael.digitalbrain.plist"
RUN_SCRIPT="$BASE_DIR/scripts/runtime/run_prod.sh"

echo "🔧 Configuring automatic startup..."

# Create .plist file
cat <<EOF > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ismael.digitalbrain</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/sh</string>
        <string>$RUN_SCRIPT</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/digitalbrain.out</string>
    <key>StandardErrorPath</key>
    <string>/tmp/digitalbrain.err</string>
    <key>WorkingDirectory</key>
    <string>$BASE_DIR</string>
</dict>
</plist>
EOF

echo "✅ File created at: $PLIST_PATH"
echo "🔄 Loading service..."

launchctl unload "$PLIST_PATH" 2>/dev/null
launchctl load "$PLIST_PATH"

echo "🚀 Done! The application will open automatically upon login."
