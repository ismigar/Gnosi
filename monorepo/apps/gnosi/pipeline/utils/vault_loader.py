import os
import yaml
import re
from pathlib import Path
from typing import List, Dict, Any, Optional
import frontmatter
import logging

log = logging.getLogger(__name__)


def get_active_vault_path() -> Optional[Path]:
    """Resolves the absolute path to the Gnosi Vault."""
    # 1. Check environment variable (Docker/CLI override)
    # Prefer GNOSI_VAULT_PATH, fallback to DIGITAL_BRAIN_VAULT_PATH (LEGACY)
    env_vault = os.environ.get("GNOSI_VAULT_PATH") or os.environ.get(
        "DIGITAL_BRAIN_VAULT_PATH"
    )
    if env_vault:
        return Path(env_vault).resolve()

    # 2. Check params.yaml (Default for local dev)
    # Finding params.yaml relative to project root
    this_file = Path(__file__).resolve()
    project_root = this_file.parents[2]  # pipeline/utils -> gnosi
    params_path = project_root / "params.yaml"

    if params_path.exists():
        try:
            with open(params_path, "r") as f:
                params = yaml.safe_load(f)
                vault_raw = params.get("vault_path") or params.get("vault")
                if vault_raw:
                    vp = Path(vault_raw)
                    if not vp.is_absolute():
                        return (project_root / vp).resolve()
                    return vp.resolve()
        except Exception as e:
            log.warning(f"Error reading params.yaml: {e}")

    return None


def extract_links(content: str) -> List[str]:
    """Extracts page IDs or titles from [[wiki-links]] or [title](local://id)."""
    links = []
    # Match [[id]] or [[id|alias]]
    wiki_links = re.findall(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]", content)
    links.extend(wiki_links)

    # Match [title](local://id)
    local_links = re.findall(r"\[[^\]]+\]\(local://([^)]+)\)", content)
    links.extend(local_links)

    return list(set(links))


def load_local_notes(table_name: Optional[str] = None) -> List[Dict[str, Any]]:
    """Load notes from the local vault."""
    vault_path = get_active_vault_path()
    if not vault_path or not vault_path.exists():
        log.error("Vault path not found or not configured.")
        return []

    # Map table_name to subfolder if applicable
    search_path = vault_path
    if table_name:
        tn_lower = table_name.lower()
        if tn_lower in ["nota permanent", "permanent"]:
            search_path = vault_path / "Wiki"
        elif tn_lower in ["nota de lectura", "lectura", "projectes", "projecte"]:
            search_path = vault_path / "BD"
        else:
            potential_sub = vault_path / table_name
            if potential_sub.exists():
                search_path = potential_sub

    notes = []
    for md_file in search_path.rglob("*.md"):
        if any(part.startswith(".") for part in md_file.parts):
            continue

        try:
            post = frontmatter.load(md_file)
            content = post.content
            metadata = post.metadata

            # Extract mentions/links locally
            mentions = extract_links(content)

            note = {
                "id": str(metadata.get("id") or md_file.stem),
                "titulo": metadata.get("title") or md_file.stem,
                "tags": metadata.get("tags") or [],
                "contenido": content,
                "contenido_md": content,
                "created_time": metadata.get("created_time") or "",
                "last_modified": os.path.getmtime(md_file),
                "url": f"local://{md_file.name}",
                "path": str(md_file),
                "mentions": mentions,
                "metadata": metadata,
            }
            notes.append(note)
        except Exception as e:
            log.warning(f"Error loading {md_file}: {e}")

    return notes
