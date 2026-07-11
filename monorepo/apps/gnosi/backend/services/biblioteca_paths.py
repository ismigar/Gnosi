"""SINGLE resolution of the Biblioteca folder: ALWAYS inside the vault.

Design decision (2026-07-03): `<vault>/Biblioteca` is the only location, both
native and in Docker. Each vault is self-contained and portable — deleting, moving, or
cloning the vault takes its PDFs with it. There is no legacy fallback: neither the
vault-container sibling (`BIBLIOTECA_HOST_PATH`, removed from the env)
nor `base.parent/Biblioteca` (which, with a child vault like Principal, would point to
the container root `.../Gnosi`).

A single source of truth for `get_p("BIBLIOTECA")` (vault_routes), the media
picker (media_service), and the Notion clone (notion_routes.save_asset).
"""
from pathlib import Path
from typing import List


def resolve_biblioteca(base: Path) -> Path:
    """Canonical root of the Biblioteca for the `base` vault (read and write)."""
    return base / "Biblioteca"


def biblioteca_roots(base: Path) -> List[Path]:
    """Biblioteca roots for the `base` vault. Under the pure vault-first design
    there is only ONE; the list form is kept for call sites that
    iterate over it (serve_biblioteca_file, portable upload values, re-root)."""
    return [resolve_biblioteca(base)]
