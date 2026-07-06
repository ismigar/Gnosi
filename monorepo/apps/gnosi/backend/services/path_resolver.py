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

    def add_file(self, vault_path: Path, record_id: Optional[str], file_path: Path) -> None:
        """Registra (o re-ubica) UN fitxer sense esperar el rescan complet.

        `update_index` només corre al rescan de vault (cooldown 600s i només
        si algú toca GET /pages): sense aquest mètode, una pàgina CREADA no
        entrava a `_vault_files` fins al següent rescan (invisible per a
        /unlinked-mentions i per al `find_path` del rule_engine), i una de
        RENOMBRADA hi quedava amb el path antic (`find_path` → None). Els
        cridadors són els mateixos punts que registren la pàgina a l'índex
        de vault_routes (create/PATCH/restore/duplicate).
        """
        v_str = str(vault_path)
        new_str = str(file_path)
        id_map = self._id_to_path.setdefault(v_str, {})
        old_str = id_map.get(record_id) if record_id else None
        if record_id:
            id_map[record_id] = new_str
        files = self._vault_files.setdefault(v_str, [])
        if old_str and old_str != new_str:
            # Rename/move: fora el path antic de la llista de fitxers.
            old_path = Path(old_str)
            self._vault_files[v_str] = files = [p for p in files if p != old_path]
        if file_path not in files:
            files.append(file_path)

    def remove_file(self, vault_path: Path, record_id: Optional[str], file_path: Optional[Path]) -> None:
        """Desregistra UN fitxer (soft-delete/purge), simètric a `add_file`."""
        v_str = str(vault_path)
        id_map = self._id_to_path.get(v_str, {})
        mapped = id_map.pop(record_id, None) if record_id else None
        targets = {p for p in (file_path, Path(mapped) if mapped else None) if p}
        if targets and v_str in self._vault_files:
            self._vault_files[v_str] = [p for p in self._vault_files[v_str] if p not in targets]

# Global singleton
path_resolver = PathResolver()
