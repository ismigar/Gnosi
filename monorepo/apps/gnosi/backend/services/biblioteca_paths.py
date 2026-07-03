"""Resolució ÚNICA de la carpeta Biblioteca (vault-first amb fallback llegat).

Canònica NOVA: `<vault>/Biblioteca` — el vault és autocontingut (el clon de Notion
la crea a dins; esborrar el vault s'ho emporta tot). Els vaults que encara tenen la
Biblioteca LLEGADA (germana del vault, p. ex. el Principal) no canvien: les
lectures fan fallback per toda la cadena i cap enllaç antic es trenca.

Un sol lloc de veritat per a `get_p("BIBLIOTECA")` (vault_routes), el media picker
(media_service) i el clon de Notion (notion_routes.save_asset).
"""
import os
from pathlib import Path
from typing import List


def biblioteca_roots(base: Path) -> List[Path]:
    """Arrels de Biblioteca del vault `base`, en ordre de resolució per a LECTURES:
      1. `<vault>/Biblioteca` (canònica).
      2. BIBLIOTECA_HOST_PATH (override explícit de layout).
      3. Germana del vault host (Docker/env: VAULT_HOST_PATH.parent/Biblioteca).
      4. Germana del vault actiu (multi-vault creat en una altra màquina, p. ex.
         Gnosi/Biblioteca germana de Gnosi/Principal).
    Dedupada preservant l'ordre."""
    roots = [base / "Biblioteca"]
    if os.environ.get("BIBLIOTECA_HOST_PATH"):
        roots.append(Path(os.environ["BIBLIOTECA_HOST_PATH"]))
    if os.environ.get("VAULT_HOST_PATH"):
        roots.append(Path(os.environ["VAULT_HOST_PATH"]).parent / "Biblioteca")
    roots.append(base.parent / "Biblioteca")
    dedup, seen = [], set()
    for r in roots:
        s = str(r)
        if s not in seen:
            seen.add(s)
            dedup.append(r)
    return dedup


def resolve_biblioteca(base: Path) -> Path:
    """Arrel canònica per a ESCRIPTURES (i primera opció de lectura): la de DINS del
    vault si existeix; si no, la llegada de sempre (cap migració forçada)."""
    inside = base / "Biblioteca"
    try:
        if inside.is_dir():
            return inside
    except OSError:
        pass   # placeholder OneDrive no llegible: tracta'l com a inexistent
    if os.environ.get("BIBLIOTECA_HOST_PATH"):
        return Path(os.environ["BIBLIOTECA_HOST_PATH"])
    if os.environ.get("VAULT_HOST_PATH"):
        return Path(os.environ["VAULT_HOST_PATH"]).parent / "Biblioteca"
    return base.parent / "Biblioteca"
