"""Resolució ÚNICA de la carpeta Biblioteca: SEMPRE dins del vault.

Decisió de disseny (2026-07-03): `<vault>/Biblioteca` és l'única ubicació, en
natiu i en Docker. Cada vault és autocontingut i portable — esborrar, moure o
clonar el vault s'emporta els seus PDFs. No hi ha fallback llegat: ni la
germana del contenidor de vaults (`BIBLIOTECA_HOST_PATH`, retirada de l'env)
ni `base.parent/Biblioteca` (que amb un vault fill com Principal apuntaria a
l'arrel del contenidor `.../Gnosi`).

Un sol lloc de veritat per a `get_p("BIBLIOTECA")` (vault_routes), el media
picker (media_service) i el clon de Notion (notion_routes.save_asset).
"""
from pathlib import Path
from typing import List


def resolve_biblioteca(base: Path) -> Path:
    """Arrel canònica de la Biblioteca del vault `base` (lectura i escriptura)."""
    return base / "Biblioteca"


def biblioteca_roots(base: Path) -> List[Path]:
    """Arrels de Biblioteca del vault `base`. Des del disseny vault-first pur
    n'hi ha UNA de sola; es manté la forma de llista pels call sites que
    iteren (serve_biblioteca_file, valors portables d'upload, re-root)."""
    return [resolve_biblioteca(base)]
