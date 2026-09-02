"""Application service for partial vault page updates."""

from __future__ import annotations

import asyncio
import errno
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from fastapi import BackgroundTasks, HTTPException

from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.pages.patch_helpers import PatchReadResult as PatchReadResult
from backend.domains.vault.schemas.pages import PagePatchRequest

Metadata = PageMetadata

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class PatchPageDependencies:
    find_and_read: Callable[[str, str | None, bool], PatchReadResult]
    get_page_write_lock: Callable[[str], Awaitable[asyncio.Lock]]
    prepare_read: Callable[[str], Awaitable[None]]
    prepare_metadata: Callable[[Metadata, Path], tuple[Metadata, Metadata | None]]
    relocate_file: Callable[[str, Path, Metadata, str | None], Path]
    process_updates: Callable[[str, Metadata, Metadata], Metadata]
    stamp_author: Callable[[Metadata, str | None, bool], None]
    persist_assets: Callable[[Metadata], Metadata]
    ensure_citation_key: Callable[[Metadata], Metadata]
    dedupe_citation_key: Callable[[Metadata, str], Metadata]
    save_page: Callable[[Path, Metadata, str], None]
    update_caches: Callable[[str, Path, Metadata, str, Metadata], None]
    create_content_version: Callable[[], Callable[[str, str], None]]
    create_file_version: Callable[[], Callable[[str, Path], None]]
    update_link_index: Callable[[], Callable[[Path], None]]
    rewrite_wikilinks: Callable[[], Callable[[str, str, str], int]]
    get_table_id: Callable[[Metadata], str | None]
    recompute_formulas: Callable[[], Callable[[str, str], None]]
    sync_calendar: Callable[[Metadata, BackgroundTasks], None]
    propagate_translation: Callable[
        [],
        Callable[[str, Metadata, Metadata, str, str], None],
    ]
    propagate_relations: Callable[
        [],
        Callable[[str, str | None, Metadata, Metadata], None],
    ]
    resolve_page_context: Callable[[Metadata, Path], tuple[str, str | None]]
    file_etag: Callable[[Path], str | None]
    safe_error_detail: Callable[[Exception, str], str]


async def patch_page(
    page_id: str,
    request: PagePatchRequest,
    background_tasks: BackgroundTasks,
    user_id: str | None,
    dependencies: PatchPageDependencies,
) -> dict[str, object]:
    """Apply one partial page mutation and update every derived index."""
    expected_etag = request.expected_etag
    force = request.force
    async with await dependencies.get_page_write_lock(page_id):
        try:
            await dependencies.prepare_read(page_id)
            file_path, metadata, body, original_raw, current_etag = await asyncio.to_thread(
                dependencies.find_and_read,
                page_id,
                expected_etag,
                force,
            )
        except OSError as exc:
            transient_errnos = {11, 35, errno.EAGAIN, errno.EDEADLK}
            if exc.errno not in transient_errnos:
                raise
            raise HTTPException(
                status_code=503,
                detail="Page temporarily unavailable; cloud download pending",
                headers={
                    "Cache-Control": "no-store, must-revalidate",
                    "Retry-After": "2",
                },
            ) from exc
        if not file_path or metadata is None or body is None:
            raise HTTPException(status_code=404, detail="Page not found")
        if expected_etag and not force and current_etag and current_etag != expected_etag:
            log.info(
                "etag mismatch (PATCH) for %s: expected=%s current=%s",
                page_id,
                expected_etag,
                current_etag,
            )
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "etag_mismatch",
                    "message": (
                        "The file has changed since you opened it. Reload it or "
                        "resend with force=true to overwrite it."
                    ),
                    "current_etag": current_etag,
                    "expected_etag": expected_etag,
                },
            )

        try:
            original_metadata = dict(metadata)
            previous_title = str(metadata.get("title") or "").strip()
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
            content = request.content if request.content is not None else body

            metadata, _table = dependencies.prepare_metadata(metadata, file_path)
            metadata["id"] = page_id
            file_path = dependencies.relocate_file(
                page_id,
                file_path,
                metadata,
                request.title,
            )
            try:
                metadata = await asyncio.to_thread(
                    dependencies.process_updates,
                    page_id,
                    original_metadata,
                    metadata,
                )
            except Exception as exc:
                log.error("Error processing automations for %s: %s", page_id, exc)
            dependencies.stamp_author(metadata, user_id, False)
            metadata = dependencies.persist_assets(metadata)
            metadata = dependencies.ensure_citation_key(metadata)
            metadata = dependencies.dedupe_citation_key(metadata, page_id)
            relation_snapshot = dict(metadata)

            await asyncio.to_thread(
                dependencies.save_page,
                file_path,
                metadata,
                content,
            )
            dependencies.update_caches(
                page_id,
                file_path,
                metadata,
                content,
                original_metadata,
            )
            if original_raw is not None:
                background_tasks.add_task(
                    dependencies.create_content_version(),
                    page_id,
                    original_raw,
                )
            else:
                background_tasks.add_task(
                    dependencies.create_file_version(),
                    page_id,
                    file_path,
                )
            background_tasks.add_task(dependencies.update_link_index(), file_path)
            new_title = str(metadata.get("title") or "").strip()
            if previous_title and new_title and previous_title != new_title:
                background_tasks.add_task(
                    dependencies.rewrite_wikilinks(),
                    page_id,
                    previous_title,
                    new_title,
                )
            table_id = dependencies.get_table_id(metadata)
            if table_id:
                background_tasks.add_task(
                    dependencies.recompute_formulas(),
                    table_id,
                    page_id,
                )
            dependencies.sync_calendar(metadata, background_tasks)
            background_tasks.add_task(
                dependencies.propagate_translation(),
                page_id,
                original_metadata,
                metadata,
                body,
                content,
            )
            background_tasks.add_task(
                dependencies.propagate_relations(),
                page_id,
                dependencies.get_table_id(metadata),
                dict(original_metadata),
                relation_snapshot,
            )
            folder, resolved_table_id = dependencies.resolve_page_context(
                metadata,
                file_path,
            )
            return {
                "status": "success",
                "id": page_id,
                "title": metadata.get("title", ""),
                "metadata": metadata,
                "content": content,
                "folder": folder,
                "resolved_table_id": resolved_table_id,
                "etag": dependencies.file_etag(file_path),
                "message": "Page partially updated",
            }
        except Exception as exc:
            log.error("Error patching page %s: %s", page_id, exc)
            raise HTTPException(
                status_code=500,
                detail=dependencies.safe_error_detail(
                    exc,
                    f"PATCH /pages/{page_id}",
                ),
            ) from exc


__all__ = ["PatchPageDependencies", "PatchReadResult", "patch_page"]
