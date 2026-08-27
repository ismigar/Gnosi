"""Permanent trash purge and best-effort trace cleanup."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypedDict


Metadata = dict[str, Any]


class PurgeResult(TypedDict):
    id: str
    freed_bytes: int


@dataclass(frozen=True)
class PurgeDependencies:
    """Ports used to irreversibly remove one trash entry and its traces."""

    entry_directory: Callable[[str], Path]
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    remove_tree: Callable[[Path], None]
    propagate_relation_inverse: Callable[
        [str, str, Metadata, Metadata],
        None,
    ]
    vault_root: Callable[[], Path]
    delete_metadata_sidecar: Callable[[Path, str], None]
    validate_page_id: Callable[[str], str]
    load_comments: Callable[[], dict[str, Any]]
    save_comments: Callable[[dict[str, Any]], None]
    inline_comments_path: Callable[[str], Path]
    logger: logging.Logger


def _entry_size(entry_directory: Path) -> int:
    total = 0
    for path in entry_directory.rglob("*"):
        try:
            if path.is_file():
                total += path.stat().st_size
        except Exception:
            pass
    return total


def _relation_metadata(
    page_id: str,
    entry_directory: Path,
    dependencies: PurgeDependencies,
) -> tuple[Metadata | None, str | None]:
    try:
        page_path = entry_directory / "page.md"
        if not page_path.exists():
            return None, None
        raw = page_path.read_text(encoding="utf-8")
        metadata, _body = dependencies.parse_frontmatter(raw, page_path)
        table_id = metadata.get("table_id") or metadata.get("database_table_id")
        return metadata, str(table_id) if table_id else None
    except Exception as exc:
        dependencies.logger.debug(
            "purge: could not read relationships for %s: %s",
            page_id,
            exc,
        )
        return None, None


def _cleanup_inverse_relations(
    page_id: str,
    metadata: Metadata | None,
    table_id: str | None,
    dependencies: PurgeDependencies,
) -> None:
    if not metadata or not table_id:
        return
    try:
        dependencies.propagate_relation_inverse(page_id, table_id, metadata, {})
    except Exception as exc:
        dependencies.logger.debug(
            "purge: inverse relationship cleanup failed for %s: %s",
            page_id,
            exc,
        )


def _cleanup_metadata_sidecar(
    page_id: str,
    dependencies: PurgeDependencies,
) -> None:
    try:
        vault_root = dependencies.vault_root()
        if vault_root:
            dependencies.delete_metadata_sidecar(vault_root, page_id)
    except Exception as exc:
        dependencies.logger.debug(
            "Could not purge the page_meta sidecar for %s: %s",
            page_id,
            exc,
        )


def _cleanup_history(page_id: str, dependencies: PurgeDependencies) -> None:
    try:
        safe_id = dependencies.validate_page_id(page_id)
        history_directory = dependencies.vault_root() / ".history" / safe_id
        if history_directory.exists():
            dependencies.remove_tree(history_directory)
    except Exception as exc:
        dependencies.logger.debug(
            "Could not purge history for %s: %s",
            page_id,
            exc,
        )


def _cleanup_comments(page_id: str, dependencies: PurgeDependencies) -> None:
    try:
        comments = dependencies.load_comments()
        if page_id in comments:
            comments.pop(page_id, None)
            dependencies.save_comments(comments)
    except Exception as exc:
        dependencies.logger.debug(
            "Could not purge comments for %s: %s",
            page_id,
            exc,
        )
    try:
        inline_path = dependencies.inline_comments_path(page_id)
        if inline_path.exists():
            inline_path.unlink()
    except Exception as exc:
        dependencies.logger.debug(
            "Could not purge inline comments for %s: %s",
            page_id,
            exc,
        )


def purge_trash_entry(
    page_id: str,
    dependencies: PurgeDependencies,
) -> PurgeResult:
    """Permanently remove a trash entry and every recoverable local trace."""
    entry_directory = dependencies.entry_directory(page_id)
    if not entry_directory.exists():
        raise FileNotFoundError(f"No trash entry for {page_id}")
    freed_bytes = _entry_size(entry_directory)
    metadata, table_id = _relation_metadata(page_id, entry_directory, dependencies)
    dependencies.remove_tree(entry_directory)
    _cleanup_inverse_relations(page_id, metadata, table_id, dependencies)
    _cleanup_metadata_sidecar(page_id, dependencies)
    _cleanup_history(page_id, dependencies)
    _cleanup_comments(page_id, dependencies)
    return {"id": page_id, "freed_bytes": freed_bytes}


__all__ = ["PurgeDependencies", "PurgeResult", "purge_trash_entry"]
