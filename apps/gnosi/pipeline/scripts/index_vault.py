import os
import sys
from pathlib import Path

# Afegir arrel del backend al path
# Pipeline està a monorepo/apps/gnosi/pipeline
# Backend està a monorepo/apps/gnosi/backend
BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(BACKEND_ROOT))
sys.path.append(str(BACKEND_ROOT.parent)) # monorepo/apps/gnosi

import backend.config.paths_config as paths_config
from backend.agent.memory import vault_store

def index_vault():
    paths = paths_config.get_paths()
    vault_path = paths["VAULT"]
    
    if not vault_path or not vault_path.exists():
        print(f"Error: Vault path {vault_path} not found.")
        return

    print(f"Indexing Vault at {vault_path}...")
    
    # Extensions a indexar
    extensions = [".md", ".txt"]
    
    count = 0
    # Recórrer Wiki i BD (que contenen markdown)
    for folder in ["Wiki", "BD"]:
        folder_path = vault_path / folder
        if not folder_path.exists():
            continue
            
        for file_path in folder_path.rglob("*"):
            if file_path.suffix in extensions:
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                        if not content.strip():
                            continue
                            
                        # Indexar fragmentat (opcionalment podríem usar RecursiveCharacterTextSplitter)
                        # Per ara, indexem el fitxer sencer si és petit o els primers 2000 caràcters
                        metadata = {
                            "source": str(file_path.relative_to(vault_path)),
                            "filename": file_path.name,
                            "folder": folder
                        }
                        
                        if vault_store.add_content(content[:4000], metadata):
                            count += 1
                            print(f"Indexed: {metadata['source']}")
                except Exception as e:
                    print(f"Error indexing {file_path}: {e}")

    print(f"Finished! Indexed {count} files.")

if __name__ == "__main__":
    index_vault()
