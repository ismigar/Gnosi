"""Propagation of translation staleness after source-page edits."""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.domains.vault.translation.types import Metadata


@dataclass(frozen=True)
class TranslationStalenessDependencies:
    table_id: Callable[[Metadata], str | None]
    table_by_id: Callable[[str | None], Metadata | None]
    content_changed: Callable[..., bool]
    find_translations: Callable[[str, Iterable[Any]], dict[str, Any]]
    page_snapshot: Callable[[], list[Any]]
    on_stale_effect: Callable[[Metadata], tuple[Metadata | None, str | None, bool]]
    persist_status_options: Callable[[str, list[Any]], None]
    find_page: Callable[[str], Path | None]
    set_stale: Callable[[str, Path, tuple[Metadata, Any] | None], bool]
    logger: logging.Logger


def _translatable_keys(table: Metadata) -> tuple[list[str], bool]:
    properties = [
        prop
        for prop in (table.get("properties") or [])
        if isinstance(prop, dict) and prop.get("translatable") is True
    ]
    keys: list[str] = []
    for prop in properties:
        for key in (prop.get("id"), prop.get("name"), *(prop.get("aliases") or [])):
            if key:
                keys.append(str(key))
    title_matters = any(
        prop.get("name") == "title" or prop.get("type") == "title" for prop in properties
    )
    return keys, title_matters


def _content_changed(
    table: Metadata | None,
    old_metadata: Metadata,
    new_metadata: Metadata,
    old_body: str | None,
    new_body: str | None,
    dependencies: TranslationStalenessDependencies,
) -> bool:
    if table and table.get("translation_enabled"):
        keys, title_matters = _translatable_keys(table)
        return dependencies.content_changed(
            keys,
            old_metadata,
            new_metadata,
            title_matters=title_matters,
        )
    return dependencies.content_changed(
        [],
        old_metadata,
        new_metadata,
        old_body=old_body,
        new_body=new_body,
        title_matters=True,
    )


def _stale_status(
    table: Metadata | None,
    dependencies: TranslationStalenessDependencies,
) -> tuple[Metadata, Any] | None:
    if not table:
        return None
    prop, value, changed = dependencies.on_stale_effect(table)
    if not prop or value is None:
        return None
    if changed:
        dependencies.persist_status_options(str(table.get("id") or ""), [value])
    return prop, value


def _translation_location(page: Any) -> tuple[str | None, object | None]:
    page_id = getattr(page, "id", None)
    page_path = getattr(page, "path", None)
    if page_id is None and isinstance(page, dict):
        page_id = page.get("id")
        page_path = page.get("path")
    return str(page_id) if page_id else None, page_path


def propagate_translation_staleness(
    origin_id: str,
    old_metadata: Metadata | None,
    new_metadata: Metadata | None,
    old_body: str | None,
    new_body: str | None,
    dependencies: TranslationStalenessDependencies,
) -> None:
    """Flag translations stale after a meaningful source-page edit."""
    try:
        current = new_metadata or {}
        previous = old_metadata or {}
        if current.get("translation_lang"):
            return
        canonical_id = str(current.get("id") or origin_id)
        table = dependencies.table_by_id(dependencies.table_id(current))
        if not _content_changed(
            table,
            previous,
            current,
            old_body,
            new_body,
            dependencies,
        ):
            return
        translations = dependencies.find_translations(
            canonical_id,
            dependencies.page_snapshot(),
        )
        if not translations:
            return
        stale_status = _stale_status(table, dependencies)
        flagged = 0
        for page in translations.values():
            page_id, raw_path = _translation_location(page)
            if not page_id:
                continue
            file_path = Path(str(raw_path)) if raw_path else dependencies.find_page(page_id)
            if (
                file_path
                and file_path.exists()
                and dependencies.set_stale(
                    page_id,
                    file_path,
                    stale_status,
                )
            ):
                flagged += 1
        if flagged:
            dependencies.logger.info(
                "Flagged %s translation(s) of %s as stale.",
                flagged,
                canonical_id,
            )
    except Exception as error:
        dependencies.logger.debug(
            "translation staleness propagation skipped: %s",
            error,
        )


__all__ = [
    "TranslationStalenessDependencies",
    "propagate_translation_staleness",
]
