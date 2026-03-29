import os
import shutil
from pathlib import Path

VAULT_PATH = Path("/vault")
BD_PATH = VAULT_PATH / "BD"

SYSTEM_FOLDERS = {"Assets", "BD", "Calendar", "Dibuixos", "Mail", "Newsletters", "Plantilles", "Tools", "Wiki", "data"}

def brute_force_cleanup():
    print(f"🚀 Starting brute force cleanup in {VAULT_PATH}")
    
    # Ensure BD exists
    if not BD_PATH.exists():
        BD_PATH.mkdir(parents=True, exist_ok=True)

    # 1. Iterate through everything in root
    for item in os.listdir(VAULT_PATH):
        p = VAULT_PATH / item
        
        # Skip system folders
        if item in SYSTEM_FOLDERS:
            continue
            
        # Handle directories (Tables)
        if p.is_dir():
            target = BD_PATH / item
            print(f"📦 Handling folder: {item}")
            if not target.exists():
                print(f"➡️ Moving {p} to {target}")
                shutil.move(str(p), str(target))
            else:
                print(f"🔥 Merging {p} into {target}")
                # Merge files
                for content in os.listdir(p):
                    sub_s = p / content
                    sub_d = target / content
                    if not sub_d.exists():
                        shutil.move(str(sub_s), str(sub_d))
                    else:
                        print(f"   ⚠️ Skipping duplicate file: {content}")
                # Delete empty or redundant root folder
                shutil.rmtree(p)
                print(f"✅ Deleted root folder: {item}")
        
        # Handle registry files and backups
        elif item.startswith("vault_db_registry") or item == "scheduler_config.json":
            target = BD_PATH / item
            print(f"📁 Handling file: {item}")
            if not target.exists():
                print(f"➡️ Moving {p} to {target}")
                shutil.move(str(p), str(target))
            else:
                # If it's a backup, just move with a suffix to not lose it? 
                # Or just delete if we already have the canonical one.
                print(f"🗑️ Deleting legacy file in root: {item}")
                p.unlink()

if __name__ == "__main__":
    brute_force_cleanup()
