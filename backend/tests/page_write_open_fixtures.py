"""Typed synthetic dependency fixtures shared by the exclusive page-write tests."""

from __future__ import annotations

import asyncio
import logging
from contextlib import nullcontext
from pathlib import Path

from backend.domains.vault.pages import patch_helpers, patch_service, save_helpers, save_service
from backend.domains.vault.pages.foundation_values import PageMetadata


def _save_helpers(root: Path) -> save_helpers.SaveHelperDependencies:
    return save_helpers.SaveHelperDependencies(
        normalize_metadata_ids=lambda metadata: metadata,
        normalize_table_context=lambda metadata: metadata,
        get_table_id=lambda metadata: None,
        table_by_id=lambda table_id: None,
        to_storage_names=lambda metadata, table: (metadata, False),
        created_iso=str,
        stamp_system_dates=lambda metadata, table, create, created: metadata,
        get_path=lambda name: root,
        is_calendar_entry=lambda metadata: False,
        resolve_table_folder=lambda metadata: None,
        canonicalize_id=str,
        parse_frontmatter=lambda raw, path: ({}, raw),
        active_vault_path=lambda: root,
        index_lock=nullcontext,
        id_to_path=dict,
        safe_filename=lambda title, directory: title,
        ensure_correct_location=lambda path, metadata: path,
        rename_to_title=lambda path, title: path,
        remove_from_index=lambda page_id, path: None,
        add_to_index=lambda path: None,
        create_page_version=lambda page_id, path: None,
        save_page=lambda path, metadata, content: None,
        logger=lambda: logging.getLogger(__name__),
    )


def _patch_helpers(root: Path) -> patch_helpers.PatchHelperDependencies:
    return patch_helpers.PatchHelperDependencies(
        find_page_for_write=lambda page_id: root / "page.md",
        file_etag=lambda path: None,
        is_dashboard_file=lambda path: False,
        read_dashboard_file=lambda path: ({}, "dashboard"),
        parse_frontmatter=lambda raw, path: ({}, raw),
        normalize_metadata_ids=lambda metadata: metadata,
        normalize_table_context=lambda metadata: metadata,
        get_table_id=lambda metadata: None,
        table_by_id=lambda table_id: None,
        to_storage_names=lambda metadata, table: (metadata, False),
        created_iso=str,
        stamp_system_dates=lambda metadata, table, create, created: metadata,
        ensure_correct_location=lambda path, metadata: path,
        rename_to_title=lambda path, title: path,
        remove_from_index=lambda page_id, path: None,
        add_to_index=lambda path: None,
        active_vault_path=lambda: root,
        index_lock=nullcontext,
        index_entries=dict,
        id_to_path=dict,
        build_cache_entry=lambda path, stat, metadata, body: {"id": "page"},
        bump_index_version=lambda key: None,
        add_to_path_resolver=lambda root, page_id, path: None,
        body_cache_lock=nullcontext,
        body_cache=dict,
        invalidate_page_responses=lambda: None,
        invalidate_citation_index=lambda: None,
        iter_docs_lock=nullcontext,
        iter_docs_cache=dict,
        path_factory=Path,
        logger=lambda: logging.getLogger(__name__),
    )


async def _write_lock(page_id: str) -> asyncio.Lock:
    return asyncio.Lock()


async def _prepare_patch_read(page_id: str) -> None:
    return None


def _save_dependencies(
    path: Path,
    previous: PageMetadata,
    events: list[str],
) -> save_service.SavePageDependencies:
    def find(page_id: str, *, allow_full_scan: bool = True) -> Path:
        assert not allow_full_scan
        events.append("find")
        return path

    def prepare(
        metadata: PageMetadata, file_path: Path | None
    ) -> tuple[
        PageMetadata,
        PageMetadata | None,
    ]:
        events.append("prepare")
        return metadata, None

    def process(page_id: str, old: PageMetadata, new: PageMetadata) -> PageMetadata:
        assert old is previous
        events.append("process")
        return new

    return save_service.SavePageDependencies(
        find_page=find,
        file_etag=lambda path: None,
        get_page_write_lock=_write_lock,
        prepare_metadata=prepare,
        locate_file=lambda page_id, title, metadata, old: path,
        read_page=lambda path: (previous, "before"),
        process_updates=process,
        stamp_author=lambda metadata, user, create: events.append("author"),
        persist_assets=lambda metadata: metadata,
        ensure_citation_key=lambda metadata, table: metadata,
        dedupe_citation_key=lambda metadata, page_id: metadata,
        write_with_version=lambda page_id, path, metadata, content: events.append("write"),
        refresh_page_index=lambda path, metadata, content: events.append("index"),
        invalidate_page_responses=lambda: events.append("invalidate"),
        update_link_index=lambda: lambda path: events.append("links"),
        rewrite_wikilinks=lambda: lambda page_id, old, new: 0,
        get_table_id=lambda metadata: None,
        recompute_formulas=lambda: lambda table_id, page_id: None,
        sync_calendar=lambda metadata, tasks: events.append("calendar"),
        propagate_translation=lambda: lambda page_id, old, new, body, content: None,
        resolve_page_context=lambda metadata, path: ("wiki", None),
    )


def _patch_dependencies(
    path: Path,
    metadata: PageMetadata,
    events: list[str],
) -> patch_service.PatchPageDependencies:
    return patch_service.PatchPageDependencies(
        find_and_read=lambda page_id, etag, force: (path, metadata, "before", "raw", None),
        get_page_write_lock=_write_lock,
        prepare_read=_prepare_patch_read,
        prepare_metadata=lambda metadata, path: (metadata, None),
        relocate_file=lambda page_id, path, metadata, title: path,
        process_updates=lambda page_id, old, new: new,
        stamp_author=lambda metadata, user, create: events.append("author"),
        persist_assets=lambda metadata: metadata,
        ensure_citation_key=lambda metadata: metadata,
        dedupe_citation_key=lambda metadata, page_id: metadata,
        save_page=lambda path, metadata, content: events.append("write"),
        update_caches=lambda page_id, path, metadata, content, old: events.append("cache"),
        create_content_version=lambda: lambda page_id, raw: events.append("content-version"),
        create_file_version=lambda: lambda page_id, path: events.append("file-version"),
        update_link_index=lambda: lambda path: events.append("links"),
        rewrite_wikilinks=lambda: lambda page_id, old, new: 0,
        get_table_id=lambda metadata: None,
        recompute_formulas=lambda: lambda table_id, page_id: None,
        sync_calendar=lambda metadata, tasks: events.append("calendar"),
        propagate_translation=lambda: lambda page_id, old, new, body, content: None,
        propagate_relations=lambda: lambda page_id, table_id, old, new: None,
        resolve_page_context=lambda metadata, path: ("wiki", None),
        file_etag=lambda path: None,
        safe_error_detail=lambda error, context: str(error),
    )
