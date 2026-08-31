"""Validate derived page-index data before it is published to shared state."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import TypeGuard

from backend.domains.vault.pages.index_entries import PageCacheEntry


def _is_entry(value: object) -> TypeGuard[PageCacheEntry]:
    return isinstance(value, dict) and all(isinstance(key, str) for key in value)


def _is_document(value: object) -> TypeGuard[dict[str, PageCacheEntry]]:
    return isinstance(value, dict) and all(
        isinstance(key, str) and _is_entry(entry) for key, entry in value.items()
    )


def prepare_page_index(
    document: object, make_path: Callable[[str], Path] = Path
) -> tuple[dict[str, PageCacheEntry], dict[object, str], list[Path]]:
    """Retain open entries and raw IDs; reject an unusable derived envelope.

    No source file or shared state is modified. In particular, a truthy
    unhashable ID must fail here, before an initialized cache can be replaced.
    Unknown fields and falsy IDs retain their existing cache behavior.
    """
    if not _is_document(document):
        raise ValueError("Invalid page-index cache: expected path-to-entry objects")
    id_map: dict[object, str] = {}
    files_ordered: list[Path] = []
    for path, entry in document.items():
        files_ordered.append(make_path(path))
        page_id = entry.get("id")
        if page_id:
            id_map[page_id] = path
    return document, id_map, files_ordered
