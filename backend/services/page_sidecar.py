"""Sidecar I/O for internal page metadata.

See `docs/dev_memory/directives/sidecar_internal_metadata.md` for the full
design. In short: internal rule_engine flags (`*_manual`) and template flags
(`is_template`, `is_default_template`) must NOT appear in the `.md`
frontmatter. They are persisted at:

    <vault>/.gnosi/page_meta/<page_id>.json

The user opens the `.md` in any editor and only sees semantic metadata.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Optional, Tuple

from backend.config.logger_config import get_logger
from backend.utils.safe_io import safe_write_json

log = get_logger(__name__)

# Static keys that always go to the sidecar.
SIDECAR_STATIC_KEYS = frozenset({"is_template", "is_default_template"})

# Subfolder inside `.gnosi/` for the sidecars.
SIDECAR_SUBDIR = "page_meta"


def is_sidecar_key(key: str) -> bool:
    """Indicates whether a metadata key is internal and must go to the sidecar."""
    if not isinstance(key, str):
        return False
    if key in SIDECAR_STATIC_KEYS:
        return True
    # All *_manual are rule_engine flags and must not live in the .md.
    return key.endswith("_manual")


def split_metadata(metadata: dict) -> Tuple[dict, dict]:
    """Splits the dict into (frontmatter_meta, sidecar_meta).

    The frontmatter contains everything semantic for the user; the sidecar
    only the internal flags. The original dict is not modified.
    
    """
    if not isinstance(metadata, dict):
        return {}, {}
    fm: dict = {}
    sc: dict = {}
    for k, v in metadata.items():
        if is_sidecar_key(k):
            sc[k] = v
        else:
            fm[k] = v
    return fm, sc


@lru_cache(maxsize=512)
def _find_vault_root(start: Path) -> Optional[Path]:
    """Walking up from `start`, returns the first ancestor that contains `.gnosi/`.

    Cached because it's called from every `parse_frontmatter`; there are
    typically few vaults per process and the search is cheap, but doing it
    3000+ times in a scan does show up. The cache keys on the ancestor (a
    Path), not the file; that's enough.
    
    """
    try:
        current = start.resolve() if start else None
    except OSError:
        current = start
    while current and current != current.parent:
        if (current / ".gnosi").is_dir():
            return current
        current = current.parent
    return None


def vault_root_for(file_path: Optional[Path]) -> Optional[Path]:
    """Public version. The lru cache lives on `_find_vault_root` per parent."""
    if not file_path:
        return None
    return _find_vault_root(Path(file_path).parent)


def sidecar_path_for(vault_root: Path, page_id: str) -> Path:
    """Sidecar location for a given page_id within a vault."""
    return Path(vault_root) / ".gnosi" / SIDECAR_SUBDIR / f"{page_id}.json"


def read_sidecar(vault_root: Path, page_id: str) -> dict:
    """Reads the sidecar JSON. Returns `{}` if it doesn't exist or is corrupt."""
    if not vault_root or not page_id:
        return {}
    path = sidecar_path_for(vault_root, page_id)
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
        log.warning(f"Sidecar at {path} no és un dict; ignorant")
        return {}
    except (OSError, json.JSONDecodeError) as e:
        log.warning(f"No s'ha pogut llegir sidecar {path}: {e}")
        return {}


def write_sidecar(vault_root: Path, page_id: str, sidecar_meta: dict) -> None:
    """Writes or removes the sidecar depending on the content.

    - If `sidecar_meta` is empty: removes the file if it exists.
    - Otherwise: writes the JSON atomically.
    
    """
    if not vault_root or not page_id:
        return
    path = sidecar_path_for(vault_root, page_id)
    if not sidecar_meta:
        if path.exists():
            try:
                path.unlink()
            except OSError as e:
                log.warning(f"No s'ha pogut eliminar sidecar {path}: {e}")
        return
    try:
        safe_write_json(path, sidecar_meta, ensure_ascii=False, indent=2)
    except OSError as e:
        log.warning(f"No s'ha pogut escriure sidecar {path}: {e}")


def delete_sidecar(vault_root: Path, page_id: str) -> None:
    """Removes a page's sidecar (e.g. when deleting the page)."""
    if not vault_root or not page_id:
        return
    path = sidecar_path_for(vault_root, page_id)
    if path.exists():
        try:
            path.unlink()
        except OSError as e:
            log.warning(f"No s'ha pogut eliminar sidecar {path}: {e}")


def apply_sidecar_to(metadata: dict, file_path: Optional[Path]) -> dict:
    """Given metadata just parsed from the frontmatter, merges in the
    corresponding sidecar if the vault root can be derived and the page has an id.

    ALWAYS returns a dict (possibly the same as the input if nothing was
    merged). Does not modify the input in place.
    
    """
    if not isinstance(metadata, dict) or not metadata:
        return metadata if isinstance(metadata, dict) else {}
    page_id = metadata.get("id")
    if not page_id:
        return metadata
    vault_root = vault_root_for(file_path)
    if not vault_root:
        return metadata
    sidecar = read_sidecar(vault_root, str(page_id))
    if not sidecar:
        return metadata
    merged = dict(metadata)
    # The sidecar wins for its own keys (it is the source of truth for
    # internal flags; if the .md still has legacy ones, the sidecar reflects
    # the correct state).
    for k, v in sidecar.items():
        merged[k] = v
    return merged


def persist_sidecar_from(metadata: dict, file_path: Optional[Path]) -> dict:
    """Given the full metadata of a page, writes the sidecar and returns the
    clean metadata (without the sidecar keys) to persist in the frontmatter.

    If the vault root cannot be derived or there is no page_id, it **does
    not** write a sidecar and returns the full metadata (fallback to the old
    behavior).
    
    """
    fm, sc = split_metadata(metadata)
    page_id = metadata.get("id") if isinstance(metadata, dict) else None
    vault_root = vault_root_for(file_path) if file_path else None
    if not page_id or not vault_root:
        # Without a stable identifier or without a vault we can't persist the sidecar.
        # We return the full metadata so the write doesn't lose flags.
        return dict(metadata) if isinstance(metadata, dict) else {}
    write_sidecar(vault_root, str(page_id), sc)
    return fm
