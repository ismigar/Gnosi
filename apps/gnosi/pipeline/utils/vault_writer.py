import os
import yaml
import re
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional
import frontmatter
from pipeline.utils.vault_loader import get_active_vault_path

import logging
log = logging.getLogger(__name__)

def create_local_note(
    title: str,
    content: str = "",
    tags: List[str] = None,
    note_type: str = "Nota permanent"
) -> Dict[str, Any]:
    """
        Creates a new Markdown note in the local Vault.
    
    """
    vault_path = get_active_vault_path()
    if not vault_path:
        raise ValueError("Could not determine the Vault path.")

    # Determine the destination folder based on the note type
    tn_lower = note_type.lower()
    if "permanent" in tn_lower or "wiki" in tn_lower:
        target_dir = vault_path / "Wiki"
    elif "lectura" in tn_lower or "projecte" in tn_lower:
        target_dir = vault_path / "BD"
    else:
        target_dir = vault_path / "Wiki" # Default

    target_dir.mkdir(parents=True, exist_ok=True)

    # Clean up the title for the file name
    safe_title = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", title).strip()
    safe_title = re.sub(r"\s+", " ", safe_title)
    if not safe_title:
        safe_title = "Untitled"

    file_path = target_dir / f"{safe_title}.md"
    
    # Avoid overwriting if it already exists (add a suffix if needed)
    counter = 1
    original_path = file_path
    while file_path.exists():
        file_path = target_dir / f"{safe_title}_{counter}.md"
        counter += 1

    # Preparar metadades (frontmatter)
    now = datetime.now().isoformat()
    metadata = {
        "title": title,
        "tags": tags or [],
        "type": note_type,
        "created_time": now,
        "id": os.urandom(8).hex() # Generate a short local ID or UUID if needed
    }

    # Write the file
    post = frontmatter.Post(content, **metadata)
    try:
        with open(file_path, "wb") as f:
            frontmatter.dump(post, f)
        
        log.info(f"✅ Nota local creada: {file_path}")
        return {
            "status": "success",
            "path": str(file_path),
            "id": metadata["id"],
            "title": title
        }
    except Exception as e:
        log.error(f"❌ Error escrivint la nota local: {e}")
        raise e

def update_local_note_relations(file_path: str, new_mentions: List[str]):
    """
        Updates the relations/mentions of an existing note.
    
    """
    p = Path(file_path)
    if not p.exists():
        log.error(f"File {file_path} does not exist; relationships cannot be updated.")
        return

    try:
        post = frontmatter.load(p)
        current_mentions = post.metadata.get("links_to", [])
        if not isinstance(current_mentions, list):
            current_mentions = [current_mentions] if current_mentions else []
        
        # Union of mentions
        updated_mentions = list(set(current_mentions + new_mentions))
        
        if len(updated_mentions) != len(current_mentions):
            post.metadata["links_to"] = updated_mentions
            with open(p, "wb") as f:
                frontmatter.dump(post, f)
            log.info(f"✅ Relacions actualitzades localment per a {p.name}")
    except Exception as e:
        log.error(f"❌ Error actualitzant relacions locals ({p.name}): {e}")
