import subprocess
import os
import datetime
import logging

# Configuration. We derive from $HOME because this is a host script (not Docker): the
# absolute path with a hardcoded macOS user broke on the other machine (the source didn't
# exist and the backup failed silently → risk of data loss).
HOME = os.path.expanduser("~")
SOURCE_DIR = f"{HOME}/Projectes/"
# Backup destination: defaults to the author's OneDrive, but overridable via
# BACKUP_DEST_DIR so it works with another cloud provider (Dropbox/iCloud/Drive) or
# without a cloud provider (a local folder). No hardcoded provider assumption.
DEST_DIR = os.environ.get("BACKUP_DEST_DIR") or f"{HOME}/Library/CloudStorage/OneDrive-UNED/Backups/Projectes/"
LOG_FILE = os.path.join(SOURCE_DIR, "Gnosi/pipeline/sandbox/backup.log")

# Exclusions
EXCLUDES = [
    "node_modules",
    "__pycache__",
    ".cache",
    ".DS_Store",
    ".venv",
    ".next",
    "dist",
    "build",
    "*.log",
    ".agent",
    ".gemini"
]

def run_backup():
    # Ensure the destination directory exists
    if not os.path.exists(DEST_DIR):
        print(f"Creant directori de destinació: {DEST_DIR}")
        os.makedirs(DEST_DIR, exist_ok=True)

    # Build the rsync command
    exclude_args = []
    for excl in EXCLUDES:
        exclude_args.extend(["--exclude", excl])

    # rsync -av --delete --progress [excludes] SOURCE DEST
    cmd = [
        "rsync",
        "-av",
        "--delete",
    ] + exclude_args + [SOURCE_DIR, DEST_DIR]

    print(f"Iniciant backup de {SOURCE_DIR} a {DEST_DIR}...")
    start_time = datetime.datetime.now()

    try:
        # Run rsync without capturing all the text in memory (avoids decoding issues)
        # and redirecting output directly to a file if needed.
        result = subprocess.run(cmd, capture_output=False, text=False)
        
        end_time = datetime.datetime.now()
        duration = end_time - start_time

        success = (result.returncode == 0)
        status_str = "SUCCESS" if success else f"FAILED (code {result.returncode})"

        # Registrar resultats
        with open(LOG_FILE, "a") as f:
            f.write(f"[{start_time.isoformat()}] BACKUP {status_str} - Duration: {duration}\n")
        
        if success:
            print(f"Backup finalitzat amb èxit en {duration}.")
        else:
            print(f"Backup ha fallat amb codi {result.returncode}.")
        print(f"Logs desats a: {LOG_FILE}")
        
    except Exception as e:
        error_msg = f"[{datetime.datetime.now().isoformat()}] BACKUP FAILED - Error: {str(e)}\n"
        print(f"ERROR: {error_msg}")
        with open(LOG_FILE, "a") as f:
            f.write(error_msg)

if __name__ == "__main__":
    run_backup()
