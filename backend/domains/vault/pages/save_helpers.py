"""Filesystem and metadata helpers for complete page saves."""

from __future__ import annotations

import logging
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

Metadata = dict[str, Any]
PageIdPaths = dict[str, dict[str, str]]


@dataclass(frozen=True)
class SaveHelperDependencies:
    """Late-bound ports used by the complete-save helper boundary."""

    normalize_metadata_ids: Callable[[Metadata], Metadata]
    normalize_table_context: Callable[[Metadata], Metadata]
    get_table_id: Callable[[Metadata], str | None]
    table_by_id: Callable[[str | None], Metadata | None]
    to_storage_names: Callable[[Metadata, Metadata], tuple[Metadata, bool]]
    created_iso: Callable[[float], str]
    stamp_system_dates: Callable[[Metadata, Metadata, bool, str | None], object]
    get_path: Callable[[str], Path]
    is_calendar_entry: Callable[[Metadata], bool]
    resolve_table_folder: Callable[[Metadata], Path | None]
    canonicalize_id: Callable[[object], str]
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    active_vault_path: Callable[[], Path | None]
    index_lock: Callable[[], AbstractContextManager[object]]
    id_to_path: Callable[[], PageIdPaths]
    safe_filename: Callable[[str, Path], str]
    ensure_correct_location: Callable[[Path, Metadata], Path]
    rename_to_title: Callable[[Path, str], Path]
    remove_from_index: Callable[[str, Path], None]
    add_to_index: Callable[[Path], None]
    create_page_version: Callable[[str, Path], object]
    save_page: Callable[[Path, Metadata, str], None]
    logger: Callable[[], logging.Logger]


def _created_fallback(
    file_path: Path | None,
    dependencies: SaveHelperDependencies,
) -> str | None:
    if not file_path:
        return None
    try:
        if not file_path.exists():
            return None
        stat_result = file_path.stat()
        created_timestamp = getattr(stat_result, "st_birthtime", 0) or stat_result.st_ctime
        return dependencies.created_iso(created_timestamp)
    except OSError:
        return None


def prepare_save_metadata(
    metadata: Metadata,
    file_path: Path | None,
    dependencies: SaveHelperDependencies,
) -> tuple[Metadata, Metadata | None]:
    """Normalize complete-save metadata and stamp table system dates."""
    metadata = dependencies.normalize_table_context(dependencies.normalize_metadata_ids(metadata))
    table = dependencies.table_by_id(dependencies.get_table_id(metadata))
    if not table:
        return metadata, None
    metadata, _changed = dependencies.to_storage_names(metadata, table)
    dependencies.stamp_system_dates(
        metadata,
        table,
        not bool(file_path),
        _created_fallback(file_path, dependencies),
    )
    return metadata, table


def _save_target_directory(
    metadata: Metadata,
    dependencies: SaveHelperDependencies,
) -> Path:
    if metadata.get("is_template") is True:
        return dependencies.get_path("PLANTILLES")
    if dependencies.is_calendar_entry(metadata):
        return dependencies.get_path("CALENDAR")
    if metadata.get("is_dashboard") is True:
        return dependencies.get_path("DASHBOARDS")
    return dependencies.resolve_table_folder(metadata) or dependencies.get_path("WIKI")


def _remember_page_path(
    page_id: str,
    file_path: Path,
    dependencies: SaveHelperDependencies,
) -> None:
    with dependencies.index_lock():
        vault_root = dependencies.active_vault_path()
        if vault_root:
            dependencies.id_to_path().setdefault(str(vault_root), {})[page_id] = str(file_path)


def _matching_file_in_directory(
    page_id: str,
    target_dir: Path,
    dependencies: SaveHelperDependencies,
) -> Path | None:
    canonical = dependencies.canonicalize_id(page_id)
    try:
        for candidate in target_dir.iterdir():
            if not candidate.is_file() or candidate.suffix != ".md":
                continue
            try:
                raw_existing = candidate.read_text(encoding="utf-8")
                existing_metadata, _body = dependencies.parse_frontmatter(
                    raw_existing,
                    candidate,
                )
                existing_id = dependencies.canonicalize_id(str(existing_metadata.get("id", "")))
                if existing_id != canonical:
                    continue
                _remember_page_path(page_id, candidate, dependencies)
                dependencies.logger().info(
                    "Reusing existing file for %s: %s",
                    page_id,
                    candidate,
                )
                return candidate
            except Exception:
                continue
    except OSError:
        pass
    return None


def _relocate_existing_save_file(
    page_id: str,
    title: str,
    metadata: Metadata,
    file_path: Path,
    dependencies: SaveHelperDependencies,
) -> Path:
    original_path = file_path
    file_path = dependencies.ensure_correct_location(file_path, metadata)
    file_path = dependencies.rename_to_title(file_path, title)
    if file_path != original_path:
        dependencies.remove_from_index(page_id, original_path)
        dependencies.add_to_index(file_path)
        _remember_page_path(page_id, file_path, dependencies)
    return file_path


def locate_save_file(
    page_id: str,
    title: str,
    metadata: Metadata,
    file_path: Path | None,
    dependencies: SaveHelperDependencies,
) -> Path:
    """Reuse, create or relocate the file backing a complete page save."""
    if file_path is not None:
        return _relocate_existing_save_file(
            page_id,
            title,
            metadata,
            file_path,
            dependencies,
        )

    target_dir = _save_target_directory(metadata, dependencies)
    target_dir.mkdir(parents=True, exist_ok=True)
    matching_file = _matching_file_in_directory(page_id, target_dir, dependencies)
    if matching_file is not None:
        return matching_file
    return target_dir / f"{dependencies.safe_filename(title, target_dir)}.md"


def read_save_page(
    file_path: Path,
    dependencies: SaveHelperDependencies,
) -> tuple[Metadata, str]:
    """Read the previous save state, retaining the historical empty fallback."""
    if not file_path.exists():
        return {}, ""
    try:
        return dependencies.parse_frontmatter(
            file_path.read_text(encoding="utf-8"),
            file_path,
        )
    except Exception:
        return {}, ""


def write_save_page_with_version(
    page_id: str,
    file_path: Path,
    metadata: Metadata,
    content: str,
    dependencies: SaveHelperDependencies,
) -> None:
    """Snapshot an existing page immediately before the complete write."""
    if file_path.exists():
        dependencies.create_page_version(page_id, file_path)
    dependencies.save_page(file_path, metadata, content)


__all__ = [
    "Metadata",
    "SaveHelperDependencies",
    "locate_save_file",
    "prepare_save_metadata",
    "read_save_page",
    "write_save_page_with_version",
]
