#!/bin/bash

# Configuration
SOURCE_DIR="/Users/ismaelgarciafernandez/Projectes/"
DEST_DIR="/Users/ismaelgarciafernandez/Library/CloudStorage/OneDrive-UNED/Backups/Projectes/"
LOG_FILE="/Users/ismaelgarciafernandez/Projectes/monorepo/apps/gnosi/pipeline/sandbox/backup_projectes.log"

# Exclusions
EXCLUDES=(
    "--exclude" "node_modules"
    "--exclude" "__pycache__"
    "--exclude" ".cache"
    "--exclude" ".DS_Store"
    "--exclude" ".venv"
    "--exclude" ".next"
    "--exclude" "dist"
    "--exclude" "build"
    "--exclude" "*.log"
    "--exclude" ".agent"
    "--exclude" ".gemini"
)

# Ensure destination directory exists
if [ ! -d "$DEST_DIR" ]; then
    echo "Creating destination directory: $DEST_DIR"
    mkdir -p "$DEST_DIR"
fi

# Start logging
START_TIME=$(date)
echo "[$START_TIME] Starting backup of $SOURCE_DIR to $DEST_DIR..." | tee -a "$LOG_FILE"

# Run rsync
rsync -av --delete "${EXCLUDES[@]}" "$SOURCE_DIR" "$DEST_DIR" >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

# End logging
END_TIME=$(date)
if [ $EXIT_CODE -eq 0 ]; then
    STATUS="SUCCESS"
    echo "[$END_TIME] Backup COMPLETED successfully." | tee -a "$LOG_FILE"
else
    STATUS="FAILED"
    echo "[$END_TIME] Backup FAILED with code $EXIT_CODE." | tee -a "$LOG_FILE"
fi

echo "----------------------------------------------------------------" >> "$LOG_FILE"
exit $EXIT_CODE
