#!/usr/bin/env bash

# Script to install the cron job
# Runs the pipeline every day at 03:05 AM

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_SCRIPT="$SCRIPT_DIR/run_pipeline_scheduled.sh"

# Check if script exists
if [ ! -f "$TARGET_SCRIPT" ]; then
    echo "❌ Error: Could not find $TARGET_SCRIPT"
    exit 1
fi

# Define cron line (03:05 AM every day)
CRON_JOB="05 03 * * * /bin/bash $TARGET_SCRIPT"

# Check if it already exists
(crontab -l 2>/dev/null | grep -F "$TARGET_SCRIPT") >/dev/null

if [ $? -eq 0 ]; then
    echo "⚠️  The job already exists in crontab."
else
    # Add the job keeping existing ones
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
    echo "✅ Job added successfully to crontab."
    echo "📅 It will run every day at 03:05 AM."
fi

echo
echo "To see your scheduled tasks:"
echo "  crontab -l"
