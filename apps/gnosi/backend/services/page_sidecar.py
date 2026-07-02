"""Sidecar I/O for internal page metadata.

Vegeu `docs/dev_memory/directives/sidecar_internal_metadata.md` per al disseny
complet. En resum: les flags internes del rule_engine (`*_manual`) i de
template (`is_template`, `is_default_template`) NO han d'aparèixer al
frontmatter del `.md`. Es persisteixen a:

    <vault>/.gnosi/page_meta/<page_id>.json

L'usuari obre el `.md` en qualsevol editor i només veu metadades semàntiques.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Optional, Tuple

from backend.config.logger_config import get_logger
from backend.utils.safe_io import safe_write_json

log = get_logger(__name__)

# Claus estàtiques que sempre van al sidecar.
SIDECAR_STATIC_KEYS = frozenset({"is_template", "is_default_template"})

# Subcarpeta dins de `.gnosi/` per als sidecars.
SIDECAR_SUBDIR = "page_meta"


def is_sidecar_key(key: str) -> bool:
    """Indica si una clau de metadata és interna i ha d'anar al sidecar."""
    if not isinstance(key, str):
        return False
    if key in SIDECAR_STATIC_KEYS:
        return True
    # Tots els *_manual són flags del rule_engine i no han de viure al .md.
    return key.endswith("_manual")


def split_metadata(metadata: dict) -> Tuple[dict, dict]:
    """Separa el dict en (frontmatter_meta, sidecar_meta).

    El frontmatter conté tot el que és semàntic per a l'usuari; el sidecar
    només les flags internes. No es modifica el dict original.
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
    """Pujant des de `start`, retorna el primer ancestor que contingui `.gnosi/`.

    Cachejat perquè es crida des de cada `parse_frontmatter`; típicament hi ha
    pocs vaults per procés i la cerca és barata, però fer-ho 3000+ vegades en
    un scan sí que es nota. La cache pren com a clau l'ancestor (un Path), no
    el fitxer; n'hi ha prou.
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
    """Versió pública. La cache lru viu a `_find_vault_root` per parent."""
    if not file_path:
        return None
    return _find_vault_root(Path(file_path).parent)


def sidecar_path_for(vault_root: Path, page_id: str) -> Path:
    """Ubicació del sidecar per a un page_id donat dins d'un vault."""
    return Path(vault_root) / ".gnosi" / SIDECAR_SUBDIR / f"{page_id}.json"


def read_sidecar(vault_root: Path, page_id: str) -> dict:
    """Llegeix el sidecar JSON. Retorna `{}` si no existeix o és corrupte."""
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
    """Escriu o elimina el sidecar segons el contingut.

    - Si `sidecar_meta` és buit: elimina el fitxer si existeix.
    - Altrament: escriu atòmicament el JSON.
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
    """Elimina el sidecar d'una pàgina (p. ex. en esborrar la pàgina)."""
    if not vault_root or not page_id:
        return
    path = sidecar_path_for(vault_root, page_id)
    if path.exists():
        try:
            path.unlink()
        except OSError as e:
            log.warning(f"No s'ha pogut eliminar sidecar {path}: {e}")


def apply_sidecar_to(metadata: dict, file_path: Optional[Path]) -> dict:
    """Donat un metadata acabat de fer parse del frontmatter, hi fusiona el
    sidecar corresponent si es pot derivar el vault root i la pàgina té id.

    Retorna SEMPRE un dict (potser el mateix de l'entrada si no s'ha fusionat
    res). No modifica l'entrada in-place.
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
    # Sidecar guanya per a les seves claus (és la font de veritat per a flags
    # internes; si el .md encara en té de llegacy, el sidecar reflecteix
    # l'estat correcte).
    for k, v in sidecar.items():
        merged[k] = v
    return merged


def persist_sidecar_from(metadata: dict, file_path: Optional[Path]) -> dict:
    """Donat el metadata complet d'una pàgina, escriu el sidecar i retorna el
    metadata net (sense les claus sidecar) per persistir-lo al frontmatter.

    Si no es pot derivar vault root o no hi ha page_id, **no** escriu sidecar
    i retorna el metadata sencer (fallback al comportament antic).
    """
    fm, sc = split_metadata(metadata)
    page_id = metadata.get("id") if isinstance(metadata, dict) else None
    vault_root = vault_root_for(file_path) if file_path else None
    if not page_id or not vault_root:
        # Sense identificador estable o sense vault no podem persistir sidecar.
        # Tornem el metadata íntegre perquè l'escriptura no perdi flags.
        return dict(metadata) if isinstance(metadata, dict) else {}
    write_sidecar(vault_root, str(page_id), sc)
    return fm
