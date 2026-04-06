#!/usr/bin/env bash

# Script: run_pipeline_scheduled.sh
# Objective: Run the pipeline keeping the Mac awake and sleep when finished (only if automatic).

# 1. Path configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$BASE_DIR/logs/scheduled_run.log"

# Create logs directory if it doesn't exist
mkdir -p "$BASE_DIR/logs"

echo "🌙 Starting scheduled execution: $(date)"  # >> "$LOG_FILE"

# 2. Environment preparation
cd "$BASE_DIR" || exit 1

# Define EXACTLY which Python we want to use (absolute path)
VENV_PYTHON="$BASE_DIR/.venv/bin/python"

if [ ! -f "$VENV_PYTHON" ]; then
    echo "❌ CRITICAL ERROR: Cannot find virtual environment Python at:" # >> "$LOG_FILE"
    echo "   $VENV_PYTHON" # >> "$LOG_FILE"
    exit 1
fi

# 3. Safe execution with Caffeinate
echo "🚀 Running pipeline (using $VENV_PYTHON)..." # >> "$LOG_FILE"

# NOTE: We no longer use "python3", but the variable "$VENV_PYTHON"
caffeinate -i "$VENV_PYTHON" -m pipeline.skills.suggest_connections_digital_brain #>> "$LOG_FILE" 2>&1

EXIT_CODE=$?

# 4. Sleep Management (Safety Check)
# If user is watching (interactive terminal), DO NOT sleep.
if [ -t 1 ]; then
    echo "⚠️  Manual mode detected (Terminal)."
    echo "🚫 Automatic sleep AVOIDED."
else
    echo "zzZ Automatic mode. Putting computer to sleep..." # >> "$LOG_FILE"
    pmset sleepnow
fi