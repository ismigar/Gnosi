#!/bin/bash

# Configuration
SOURCE="/Users/ismaelgarciafernandez/Zotero"
DEST="/Users/ismaelgarciafernandez/OneDrive/Backups/Zotero"
LOGFILE="/Users/ismaelgarciafernandez/backup_zotero.log"

# Function to log messages
log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOGFILE"
}

log_message "Starting Zotero backup..."

# Check source existence
if [ ! -d "$SOURCE" ]; then
    log_message "ERROR: Source directory $SOURCE does not exist."
    exit 1
fi

# Ensure destination parent exists
if [ ! -d "$(dirname "$DEST")" ]; then
    log_message "ERROR: Destination parent directory $(dirname "$DEST") does not exist."
    exit 1
fi

# Execute rsync
# -a: archive mode (recursive, preserves permissions, timestamps, etc.)
# -v: verbose
# --delete: remove files in dest that are not in source (exact mirror)
rsync -av --delete "$SOURCE/" "$DEST/" >> "$LOGFILE" 2>&1

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    log_message "Backup completed successfully."
else
    log_message "Backup failed with exit code $EXIT_CODE."
fi

exit $EXIT_CODE
