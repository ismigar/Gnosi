"""Filesystem orchestration for bidirectional Vault relation synchronization."""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path

from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.pages.index_entries import PageCacheEntry
from backend.services.relation_sync import RelationChange as RelationChange


Metadata = PageMetadata
PageCache = dict[str, dict[str, PageCacheEntry]]
PagePaths = dict[str, dict[object, str]]


@dataclass(frozen=True)
class RelationSyncDependencies:
    """Late-bound relation rules, page IO, cache, and logging ports."""

    normalize_name: Callable[[object], str]
    relation_ids: Callable[[object], list[str]]
    relation_changes: Callable[
        [Metadata, Metadata, Metadata, Callable[[str], Metadata | None]],
        list[RelationChange],
    ]
    table_by_id: Callable[[str], Metadata | None]
    find_page: Callable[[str], Path | None]
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    save_page: Callable[[Path, Metadata, str], None]
    update_link_index: Callable[[Path], None]
    active_vault_path: Callable[[], Path | None]
    build_page_cache_entry: Callable[[Path, os.stat_result], PageCacheEntry]
    page_index_lock: Callable[[], AbstractContextManager[object]]
    page_index_entries: Callable[[], PageCache]
    page_id_to_path: Callable[[], PagePaths]
    bump_page_index_version: Callable[[str], None]
    invalidate_page_responses: Callable[[], None]
    logger: logging.Logger


def inverse_frontmatter_key(
    metadata: Metadata,
    inverse_name: str,
    dependencies: RelationSyncDependencies,
) -> str:
    """Reuse a normalized existing key before falling back to the schema name."""
    if inverse_name in metadata:
        return inverse_name
    normalized_inverse = dependencies.normalize_name(inverse_name)
    for key in metadata:
        if isinstance(key, str) and dependencies.normalize_name(key) == normalized_inverse:
            return key
    return inverse_name


def _refresh_page_cache(
    target_id: str,
    file_path: Path,
    dependencies: RelationSyncDependencies,
) -> None:
    try:
        vault_path = dependencies.active_vault_path()
        if not vault_path:
            return
        vault_key = str(vault_path)
        entry = dependencies.build_page_cache_entry(file_path, file_path.stat())
        with dependencies.page_index_lock():
            dependencies.page_index_entries().setdefault(vault_key, {})[str(file_path)] = entry
            entry_id = entry.get("id")
            if entry_id:
                dependencies.page_id_to_path().setdefault(vault_key, {})[str(entry_id)] = str(
                    file_path
                )
            dependencies.bump_page_index_version(vault_key)
    except Exception as error:
        dependencies.logger.debug(
            "relation sync: cache update failed for %s: %s",
            target_id,
            error,
        )


def apply_inverse_change(
    target_id: str,
    inverse_name: str,
    host_id: str,
    operation: str,
    dependencies: RelationSyncDependencies,
) -> bool:
    """Apply one idempotent inverse relation mutation to the target page."""
    file_path = dependencies.find_page(target_id)
    if not file_path or not file_path.exists():
        return False
    metadata, body = dependencies.parse_frontmatter(
        file_path.read_text(encoding="utf-8"),
        file_path,
    )
    key = inverse_frontmatter_key(metadata, inverse_name, dependencies)
    current = dependencies.relation_ids(metadata.get(key))
    if operation == "add":
        if host_id in current:
            return False
        metadata[key] = [*current, host_id]
    elif operation == "remove":
        if host_id not in current:
            return False
        metadata[key] = [value for value in current if value != host_id]
    else:
        return False
    dependencies.save_page(file_path, metadata, body)
    try:
        dependencies.update_link_index(file_path)
    except Exception as error:
        dependencies.logger.debug(
            "relation sync: link-index update failed for %s: %s",
            target_id,
            error,
        )
    _refresh_page_cache(target_id, file_path, dependencies)
    return True


def propagate_inverse(
    page_id: str,
    table_id: str | None,
    old_metadata: Metadata,
    new_metadata: Metadata,
    dependencies: RelationSyncDependencies,
) -> None:
    """Propagate direct relation changes without blocking the calling write."""
    try:
        if not table_id:
            return
        origin = dependencies.table_by_id(table_id)
        if not origin:
            return
        changes = dependencies.relation_changes(
            old_metadata,
            new_metadata,
            origin,
            dependencies.table_by_id,
        )
        wrote = False
        for target_id, inverse_name, operation in changes:
            if not target_id or target_id == page_id:
                continue
            try:
                wrote = (
                    apply_inverse_change(
                        target_id,
                        inverse_name,
                        page_id,
                        operation,
                        dependencies,
                    )
                    or wrote
                )
            except Exception as error:
                dependencies.logger.debug(
                    "relation sync target %s (%s) failed: %s",
                    target_id,
                    operation,
                    error,
                )
        if wrote:
            dependencies.invalidate_page_responses()
    except Exception as error:
        dependencies.logger.debug(
            "relation inverse propagation failed for %s: %s",
            page_id,
            error,
        )


__all__ = [
    "Metadata",
    "RelationChange",
    "RelationSyncDependencies",
    "apply_inverse_change",
    "inverse_frontmatter_key",
    "propagate_inverse",
]
