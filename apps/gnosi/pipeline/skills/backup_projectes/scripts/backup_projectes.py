import subprocess
import os
import datetime
import logging

# Configuació
SOURCE_DIR = "/Users/ismaelgarciafernandez/Projectes/"
DEST_DIR = "/Users/ismaelgarciafernandez/Library/CloudStorage/OneDrive-UNED/Backups/Projectes/"
LOG_FILE = os.path.join(SOURCE_DIR, "monorepo/apps/digital-brain/pipeline/sandbox/backup.log")

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
    # Assegurar que el directori de destinació existeix
    if not os.path.exists(DEST_DIR):
        print(f"Creant directori de destinació: {DEST_DIR}")
        os.makedirs(DEST_DIR, exist_ok=True)

    # Construir el comandament rsync
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
        # Executar rsync sense capturar tot el text a memòria (evita problemes de decodificació)
        # i redirigint la sortida a un fitxer directament si calgués.
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
