#!/usr/bin/env bash

# Script: run_pipeline_scheduled.sh
# Objective: Run the pipeline keeping the Mac awake and sleep when finished (only if automatic).

# 1. Path configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_FILE="$BASE_DIR/logs/scheduled_run.log"

# Create logs directory if it doesn't exist
mkdir -p "$BASE_DIR/logs"

echo "🌙 Starting scheduled execution: $(date)"  # >> "$LOG_FILE"

# 2. Environment preparation
cd "$BASE_DIR" || exit 1

# 3. Safe execution with Caffeinate
echo "🚀 Running pipeline with the frozen uv environment..." # >> "$LOG_FILE"

# Use the same canonical Brain proposal service as the Gnosi scheduler.
caffeinate -i uv run python -c 'import json; from backend.services.llm_wiki_actions import run_maintenance; print(json.dumps(run_maintenance(semantic=True), ensure_ascii=False))' #>> "$LOG_FILE" 2>&1

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
