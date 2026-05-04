import os
from pathlib import Path
from typing import Dict, List, Optional, Set
import logging

log = logging.getLogger(__name__)

class PathResolver:
    """
    High-performance singleton for resolving vault paths by ID and querying groups of files.
    Avoids expensive rglob calls during rule evaluation and indexing.
    """
    _instance = None
    _id_to_path: Dict[str, Dict[str, str]] = {} # vault_str -> {id: abs_path}
    _vault_files: Dict[str, List[Path]] = {}    # vault_str -> list of all relevant .md files

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(PathResolver, cls).__new__(cls)
        return cls._instance

    def update_index(self, vault_path: Path, id_to_path: Dict[str, str], all_files: List[Path]):
        """Populated by vault_routes during indexing."""
        v_str = str(vault_path)
        self._id_to_path[v_str] = id_to_path
        self._vault_files[v_str] = all_files
        log.info(f"🚀 PathResolver updated for {v_str}: {len(id_to_path)} IDs, {len(all_files)} files.")

    def find_path(self, record_id: str, vault_path: Path) -> Optional[Path]:
        """Resolves an ID to a Path in O(1)."""
        v_str = str(vault_path)
        path_str = self._id_to_path.get(v_str, {}).get(record_id)
        if path_str:
            p = Path(path_str)
            if p.exists():
                return p
        return None

    def list_all_files(self, vault_path: Path) -> List[Path]:
        """Returns all cached files for a vault. Fallback to rglob if empty (slow)."""
        v_str = str(vault_path)
        files = self._vault_files.get(v_str, [])
        if not files:
            log.warning(f"⚠️ PathResolver cache miss for {v_str}. Falling back to slow rglob.")
            # We don't want to block, but sometimes we must if indexing hasn't finished
            return list(vault_path.rglob("*.md"))
        return files

# Global singleton
path_resolver = PathResolver()
