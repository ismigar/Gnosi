"""SINGLE resolution of the attachments folder: ALWAYS `<vault>/Library`.

Design decision: the attachments folder lives inside the vault (both native and in
Docker), named `Library`. Each vault is self-contained and portable — deleting,
moving, or cloning the vault takes its PDFs with it. There is no fallback: neither a
vault-container sibling (`LIBRARY_HOST_PATH`, removed from the env) nor
`base.parent/Library` (which, with a child vault like Principal, would point to the
container root `.../Gnosi`).

A single source of truth for `get_p("LIBRARY")` (vault_routes), the media picker
(media_service), and the Notion clone (notion_routes.save_asset).
"""
import operator
from pathlib import Path
from typing import List


def resolve_library(base: Path | None) -> Path:
    """Canonical root of the Library (attachments) folder for `base` (read and write)."""
    # Compatibility callers may supply None while resolving an inactive vault.
    # Keep the native division TypeError; the caller owns its fallback policy.
    library: Path = operator.truediv(base, "Library")
    return library


def library_roots(base: Path | None) -> List[Path]:
    """Library roots for `base`. There is a single root; the list form is kept for the
    call sites that iterate over it (serve_library_file, portable upload values, re-root)."""
    return [resolve_library(base)]
