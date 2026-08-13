import shutil
import os
import yaml
from pathlib import Path

def migrate():
    # 1. Paths
    repo_root = Path(__file__).resolve().parents[2]
    local_params = repo_root / "config" / "params.yaml"
    local_instructions = repo_root / "backend" / "agent" / "instructions"
    local_tools_dir = repo_root / "backend" / "agent" / "generated_tools"

    if not local_params.exists():
        print(f"ERROR: Local params not found at {local_params}")
        return

    # 2. Get Vault Path
    with open(local_params, "r", encoding="utf-8") as f:
        params = yaml.safe_load(f)
    
    vault_raw = params.get("paths", {}).get("vault")
    if not vault_raw:
        print("ERROR: Vault path not defined in params.yaml")
        return
    
    vault_path = Path(vault_raw)
    dot_gnosi = vault_path / ".gnosi"
    
    print(f"Target Vault: {vault_path}")
    print(f"Configuring .gnosi at: {dot_gnosi}")

    # 3. Create structure
    target_instructions = dot_gnosi / "agent" / "instructions"
    target_tools = dot_gnosi / "agent" / "generated_tools"
    
    target_instructions.mkdir(parents=True, exist_ok=True)
    target_tools.mkdir(parents=True, exist_ok=True)

    # 4. Copy params.yaml
    target_params = dot_gnosi / "params.yaml"
    shutil.copy2(local_params, target_params)
    print(f"Copied params.yaml to {target_params}")

    # 5. Copy Instructions
    if local_instructions.exists():
        for item in local_instructions.iterdir():
            if item.is_file():
                shutil.copy2(item, target_instructions / item.name)
        print(f"Copied instructions to {target_instructions}")

    # 6. Copy ONLY Generated Tools and Data
    # Path inside generated_tools: approved/, data/
    if local_tools_dir.exists():
        for subname in ["approved", "data"]:
            local_sub = local_tools_dir / subname
            if local_sub.exists() and local_sub.is_dir():
                dest_sub = target_tools / subname
                if dest_sub.exists():
                    shutil.rmtree(dest_sub)
                shutil.copytree(local_sub, dest_sub)
                print(f"Copied {subname}/ to {dest_sub}")

    print("\nMigration complete! You can now update the app logic to point to these paths.")

if __name__ == "__main__":
    migrate()
