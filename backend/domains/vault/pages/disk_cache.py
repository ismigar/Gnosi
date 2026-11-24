"""Validate derived page-index data before it is published to shared state."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from pathlib import Path
from typing import TypeGuard

from backend.domains.vault.pages.index_entries import PageCacheEntry, newer_index_entry
from backend.utils.metadata_io import MetadataUnavailable, read_metadata_text


def coverage_path(cache: Path) -> Path:
    return cache.with_suffix(".coverage.json")


def full_coverage_record(vault_key: str, raw: str) -> dict[str, str]:
    return {"vault": vault_key, "sha256": hashlib.sha256(raw.encode("utf-8")).hexdigest()}


def has_full_coverage(cache: Path, vault_key: str, raw: str) -> bool:
    try:
        record: object = json.loads(read_metadata_text(coverage_path(cache)))
    except (OSError, ValueError, MetadataUnavailable):
        return False
    return record == full_coverage_record(vault_key, raw)


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
        if page_id and newer_index_entry(entry, document.get(id_map.get(page_id, ""))):
            id_map[page_id] = path
    return document, id_map, files_ordered
