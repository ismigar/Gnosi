#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
RUNNER="$SCRIPT_DIR/auto_improver.py"
LABEL="com.gnosi.auto-improver"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/Gnosi"

mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"
chmod +x "$RUNNER"
/usr/bin/python3 - "$PLIST" "$LABEL" "$RUNNER" "$LOG_DIR" <<'PY'
import plistlib
import sys
path, label, runner, log_dir = sys.argv[1:]
payload = {
    "Label": label,
    "ProgramArguments": ["/usr/bin/python3", runner],
    "StartCalendarInterval": [{"Hour": 6, "Minute": 0}, {"Hour": 18, "Minute": 0}],
    "ProcessType": "Background",
    "StandardOutPath": f"{log_dir}/auto-improver.log",
    "StandardErrorPath": f"{log_dir}/auto-improver.err",
}
with open(path, "wb") as output:
    plistlib.dump(payload, output)
PY
GUI="gui/$(id -u)"
launchctl bootout "$GUI/$LABEL" 2>/dev/null || true
launchctl bootstrap "$GUI" "$PLIST"
echo "Installed $LABEL: 06:00 and 18:00 local time."
