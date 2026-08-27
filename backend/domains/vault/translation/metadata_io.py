"""Minimal metadata writes used by translation lifecycle effects."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.domains.vault.translation.types import Metadata


@dataclass(frozen=True)
class TranslationMetadataDependencies:
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    save_page: Callable[[Path, Metadata, str], None]
    refresh_page_index: Callable[[Path, Metadata, str], None]
    invalidate_pages: Callable[[], None]
    effect_write_key: Callable[[Metadata, Metadata], str | None]
    logger: logging.Logger


def _read_page(
    page_id: str,
    file_path: Path,
    operation: str,
    dependencies: TranslationMetadataDependencies,
) -> tuple[Metadata, str] | None:
    try:
        raw = file_path.read_text(encoding="utf-8")
        return dependencies.parse_frontmatter(raw, file_path)
    except Exception as error:
        dependencies.logger.warning(
            "%s read failed for %s: %s",
            operation,
            page_id,
            error,
        )
        return None


def _write_page(
    page_id: str,
    file_path: Path,
    metadata: Metadata,
    body: str,
    operation: str,
    dependencies: TranslationMetadataDependencies,
) -> bool:
    try:
        dependencies.save_page(file_path, metadata, body)
    except Exception as error:
        dependencies.logger.warning(
            "%s write failed for %s: %s",
            operation,
            page_id,
            error,
        )
        return False
    dependencies.refresh_page_index(file_path, metadata, body)
    dependencies.invalidate_pages()
    return True


def write_metadata_key_on_disk(
    page_id: str,
    file_path: Path,
    key: str,
    value: Any,
    dependencies: TranslationMetadataDependencies,
) -> bool:
    """Write one metadata key directly, avoiding recursive action hooks."""
    loaded = _read_page(page_id, file_path, "status-effect", dependencies)
    if loaded is None:
        return False
    metadata, body = loaded
    if metadata.get(key) == value:
        return False
    metadata[key] = value
    return _write_page(
        page_id,
        file_path,
        metadata,
        body,
        "status-effect",
        dependencies,
    )


def set_translation_stale_on_disk(
    page_id: str,
    file_path: Path,
    stale_status: tuple[Metadata, Any] | None,
    dependencies: TranslationMetadataDependencies,
) -> bool:
    """Idempotently mark one translation stale with an optional status effect."""
    loaded = _read_page(page_id, file_path, "stale-flag", dependencies)
    if loaded is None:
        return False
    metadata, body = loaded
    if metadata.get("translation_stale") is True:
        return False
    metadata["translation_stale"] = True
    if stale_status:
        prop, value = stale_status
        key = dependencies.effect_write_key(metadata, prop)
        if key:
            metadata[key] = value
    return _write_page(
        page_id,
        file_path,
        metadata,
        body,
        "stale-flag",
        dependencies,
    )


__all__ = [
    "TranslationMetadataDependencies",
    "set_translation_stale_on_disk",
    "write_metadata_key_on_disk",
]
