"""Filesystem, metadata and cache helpers for partial page updates."""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path

from backend.domains.vault.links.document_cache import BodyCache as BodyCache
from backend.domains.vault.links.document_inventory import (
    DocumentCache,
    LinkableDocument,
)
from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.pages.index_entries import PageCacheEntry as PageCacheEntry
from backend.domains.vault.schemas.pages import PagePatchRequest

Metadata = PageMetadata
PageIndexEntries = dict[str, dict[str, PageCacheEntry]]
PageIdPaths = dict[str, dict[object, str]]
IterDocument = LinkableDocument
IterDocsCache = DocumentCache
PatchReadResult = tuple[
    Path | None,
    Metadata | None,
    str | None,
    str | None,
    str | None,
]


def apply_patch_request(metadata: Metadata, request: PagePatchRequest) -> str | None:
    """Apply user-provided partial fields and return the optional replacement body."""
    if request.title is not None:
        metadata["title"] = request.title
    if request.parent_id is not None:
        metadata["parent_id"] = request.parent_id
    if request.is_database is not None:
        metadata["is_database"] = request.is_database
    if request.metadata is not None:
        metadata.update(request.metadata)
    if request.remove_metadata_keys:
        for key in request.remove_metadata_keys:
            metadata.pop(key, None)
    return request.content


@dataclass(frozen=True)
class PatchHelperDependencies:
    """Late-bound ports used by the partial-update helper boundary."""

    find_page_for_write: Callable[[str], Path | None]
    file_etag: Callable[[Path], str | None]
    is_dashboard_file: Callable[[Path], bool]
    read_dashboard_file: Callable[[Path], tuple[Metadata, str]]
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    normalize_metadata_ids: Callable[[Metadata], Metadata]
    normalize_table_context: Callable[[Metadata], Metadata]
    get_table_id: Callable[[Metadata], str | None]
    table_by_id: Callable[[str | None], Metadata | None]
    to_storage_names: Callable[[Metadata, Metadata], tuple[Metadata, bool]]
    created_iso: Callable[[float], str]
    stamp_system_dates: Callable[[Metadata, Metadata, bool, str | None], Metadata]
    ensure_correct_location: Callable[[Path, Metadata], Path]
    rename_to_title: Callable[[Path, str], Path]
    remove_from_index: Callable[[str, Path], None]
    add_to_index: Callable[[Path], None]
    active_vault_path: Callable[[], Path | None]
    index_lock: Callable[[], AbstractContextManager[object]]
    index_entries: Callable[[], PageIndexEntries]
    id_to_path: Callable[[], PageIdPaths]
    build_cache_entry: Callable[
        [Path, os.stat_result, Metadata, str],
        PageCacheEntry,
    ]
    bump_index_version: Callable[[str], None]
    add_to_path_resolver: Callable[[Path, object, Path], None]
    body_cache_lock: Callable[[], AbstractContextManager[object]]
    body_cache: Callable[[], BodyCache]
    invalidate_page_responses: Callable[[], None]
    invalidate_citation_index: Callable[[], None]
    iter_docs_lock: Callable[[], AbstractContextManager[object]]
    iter_docs_cache: Callable[[], IterDocsCache]
    path_factory: Callable[[str], Path]
    logger: Callable[[], logging.Logger]


def find_and_read_patch_page(
    page_id: str,
    expected_etag: str | None,
    force: bool,
    dependencies: PatchHelperDependencies,
) -> PatchReadResult:
    """Locate and read the current page while preserving ETag short-circuiting."""
    file_path = dependencies.find_page_for_write(page_id)
    if not file_path:
        return None, None, None, None, None
    current_etag = None
    if expected_etag and not force:
        current_etag = dependencies.file_etag(file_path)
        if current_etag and current_etag != expected_etag:
            return file_path, None, None, None, current_etag
    if dependencies.is_dashboard_file(file_path):
        metadata, body = dependencies.read_dashboard_file(file_path)
        return file_path, metadata, body, None, current_etag
    raw_content = file_path.read_text(encoding="utf-8")
    metadata, body = dependencies.parse_frontmatter(raw_content, file_path)
    return file_path, metadata, body, raw_content, current_etag


def _created_fallback(
    file_path: Path,
    dependencies: PatchHelperDependencies,
) -> str | None:
    try:
        stat_result = file_path.stat()
        created_timestamp = getattr(stat_result, "st_birthtime", 0) or stat_result.st_ctime
        return dependencies.created_iso(created_timestamp)
    except OSError:
        return None


def prepare_patch_metadata(
    metadata: Metadata,
    file_path: Path,
    dependencies: PatchHelperDependencies,
) -> tuple[Metadata, Metadata | None]:
    """Normalize partial-update metadata and preserve dashboard storage rules."""
    metadata = dependencies.normalize_table_context(dependencies.normalize_metadata_ids(metadata))
    table = dependencies.table_by_id(dependencies.get_table_id(metadata))
    if table:
        metadata, _changed = dependencies.to_storage_names(metadata, table)
        dependencies.stamp_system_dates(
            metadata,
            table,
            False,
            _created_fallback(file_path, dependencies),
        )
    if metadata.get("is_dashboard") is True:
        metadata.pop("content_format", None)
    return metadata, table


def _remember_page_path(
    page_id: str,
    file_path: Path,
    dependencies: PatchHelperDependencies,
) -> None:
    with dependencies.index_lock():
        vault_root = dependencies.active_vault_path()
        if vault_root:
            dependencies.id_to_path().setdefault(str(vault_root), {})[page_id] = str(file_path)


def relocate_patch_file(
    page_id: str,
    file_path: Path,
    metadata: Metadata,
    title: str | None,
    dependencies: PatchHelperDependencies,
) -> Path:
    """Move a patched file to its canonical folder and title-derived name."""
    original_path = file_path
    file_path = dependencies.ensure_correct_location(file_path, metadata)
    if title is not None:
        file_path = dependencies.rename_to_title(file_path, title)
    if file_path != original_path:
        dependencies.remove_from_index(page_id, original_path)
        dependencies.add_to_index(file_path)
        _remember_page_path(page_id, file_path, dependencies)
    return file_path


def _refresh_patch_page_index(
    page_id: str,
    file_path: Path,
    metadata: Metadata,
    content: str,
    vault_path: Path,
    vault_key: str,
    dependencies: PatchHelperDependencies,
) -> None:
    try:
        new_entry = dependencies.build_cache_entry(
            file_path,
            file_path.stat(),
            metadata,
            content,
        )
        new_id = new_entry.get("id")
        with dependencies.index_lock():
            dependencies.index_entries().setdefault(vault_key, {})[str(file_path)] = new_entry
            if new_id:
                dependencies.id_to_path().setdefault(vault_key, {})[new_id] = str(file_path)
            dependencies.bump_index_version(vault_key)
        dependencies.add_to_path_resolver(
            vault_path,
            new_id or page_id,
            file_path,
        )
    except Exception as exc:
        dependencies.logger().debug(
            "Cache update after PATCH failed for %s: %s",
            page_id,
            exc,
        )


def _invalidate_patch_caches(
    file_path: Path,
    metadata: Metadata,
    original_metadata: Metadata,
    dependencies: PatchHelperDependencies,
) -> None:
    with dependencies.body_cache_lock():
        dependencies.body_cache().pop(str(file_path), None)
    dependencies.invalidate_page_responses()
    if str(original_metadata.get("Citation Key") or "") != str(metadata.get("Citation Key") or ""):
        dependencies.invalidate_citation_index()


def _update_iter_documents(
    file_path: Path,
    metadata: Metadata,
    content: str,
    vault_key: str,
    dependencies: PatchHelperDependencies,
) -> None:
    with dependencies.iter_docs_lock():
        cache_entry = dependencies.iter_docs_cache().get(vault_key)
        docs = cache_entry.get("docs") if cache_entry else None
        if docs is None:
            return
        path_str = str(file_path)
        new_doc: IterDocument = (
            dependencies.path_factory(path_str),
            dict(metadata),
            content,
            dependencies.is_dashboard_file(file_path),
        )
        for index, document in enumerate(docs):
            if str(document[0]) == path_str:
                docs[index] = new_doc
                break
        else:
            docs.append(new_doc)


def update_patch_caches(
    page_id: str,
    file_path: Path,
    metadata: Metadata,
    content: str,
    original_metadata: Metadata,
    dependencies: PatchHelperDependencies,
) -> None:
    """Refresh every derived cache after a successful partial write."""
    try:
        vault_path = dependencies.active_vault_path()
        vault_key = str(vault_path) if vault_path else ""
        if vault_path:
            _refresh_patch_page_index(
                page_id,
                file_path,
                metadata,
                content,
                vault_path,
                vault_key,
                dependencies,
            )
        _invalidate_patch_caches(
            file_path,
            metadata,
            original_metadata,
            dependencies,
        )
        if vault_key:
            _update_iter_documents(
                file_path,
                metadata,
                content,
                vault_key,
                dependencies,
            )
    except Exception as exc:
        dependencies.logger().debug(
            "Cache invalidation after PATCH failed: %s",
            exc,
        )


__all__ = [
    "Metadata",
    "PatchHelperDependencies",
    "PatchReadResult",
    "apply_patch_request",
    "find_and_read_patch_page",
    "prepare_patch_metadata",
    "relocate_patch_file",
    "update_patch_caches",
]
