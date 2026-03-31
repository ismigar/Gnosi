import os
import shutil
import argparse
from pathlib import Path

VAULT_PATH = Path("/vault")
BD_PATH = VAULT_PATH / "BD"

SYSTEM_FOLDERS = {"Assets", "BD", "Calendar", "Dibuixos", "Mail", "Newsletters", "Plantilles", "Tools", "Wiki", "data"}

def brute_force_cleanup(dry_run=True):
    print(f"🚀 Starting cleanup in {VAULT_PATH} (Dry Run: {dry_run})")
    
    # Ensure BD exists
    if not BD_PATH.exists():
        if not dry_run:
            BD_PATH.mkdir(parents=True, exist_ok=True)
        else:
            print(f"[SIMULATED] Would create: {BD_PATH}")

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
                print(f"➡️ [ACTION] Moving {p} to {target}")
                if not dry_run:
                    shutil.move(str(p), str(target))
            else:
                print(f"🔥 [ACTION] Merging {p} into {target}")
                # Merge files
                for content in os.listdir(p):
                    sub_s = p / content
                    sub_d = target / content
                    if not sub_d.exists():
                        if not dry_run:
                            shutil.move(str(sub_s), str(sub_d))
                    else:
                        print(f"   ⚠️ Skipping duplicate file: {content}")
                
                # Delete empty or redundant root folder
                if not dry_run:
                    shutil.rmtree(p)
                    print(f"✅ Deleted root folder: {item}")
                else:
                    print(f"[SIMULATED] Would delete folder: {item}")
        
        # Handle registry files and backups
        elif item.startswith("vault_db_registry") or item == "scheduler_config.json":
            target = BD_PATH / item
            print(f"📁 Handling file: {item}")
            if not target.exists():
                print(f"➡️ [ACTION] Moving {p} to {target}")
                if not dry_run:
                    shutil.move(str(p), str(target))
            else:
                print(f"🗑️ [ACTION] Deleting legacy file in root: {item}")
                if not dry_run:
                    p.unlink()
                else:
                    print(f"[SIMULATED] Would unlink: {item}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cleanup for Vault root")
    parser.add_argument("--force", action="store_true", help="Actually execute deletions and moves")
    args = parser.parse_args()
    
    brute_force_cleanup(dry_run=not args.force)
