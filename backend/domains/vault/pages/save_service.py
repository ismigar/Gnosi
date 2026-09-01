"""Application service for complete vault page saves."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from fastapi import BackgroundTasks, HTTPException

from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.registry.records import is_record
from backend.domains.vault.schemas.pages import PageSaveRequest

Metadata = PageMetadata

log = logging.getLogger(__name__)


class PageFinder(Protocol):
    def __call__(
        self,
        page_id: str,
        *,
        allow_full_scan: bool = True,
    ) -> Path | None: ...


@dataclass(frozen=True)
class SavePageDependencies:
    find_page: PageFinder
    file_etag: Callable[[Path], str | None]
    get_page_write_lock: Callable[[str], Awaitable[asyncio.Lock]]
    prepare_metadata: Callable[[Metadata, Path | None], tuple[Metadata, Metadata | None]]
    locate_file: Callable[[str, str, Metadata, Path | None], Path]
    read_page: Callable[[Path], tuple[Metadata, str]]
    process_updates: Callable[[str, Metadata, Metadata], Metadata]
    stamp_author: Callable[[Metadata, str | None, bool], None]
    persist_assets: Callable[[Metadata], Metadata]
    ensure_citation_key: Callable[[Metadata, Metadata | None], Metadata]
    dedupe_citation_key: Callable[[Metadata, str], Metadata]
    write_with_version: Callable[[str, Path, Metadata, str], None]
    refresh_page_index: Callable[[Path, Metadata, str], None]
    invalidate_page_responses: Callable[[], None]
    update_link_index: Callable[[], Callable[[Path], None]]
    rewrite_wikilinks: Callable[[], Callable[[str, str, str], int]]
    get_table_id: Callable[[Metadata], str | None]
    recompute_formulas: Callable[[], Callable[[str, str], None]]
    sync_calendar: Callable[[Metadata, BackgroundTasks], None]
    propagate_translation: Callable[
        [],
        Callable[[str, Metadata, Metadata, str, str], None],
    ]
    resolve_page_context: Callable[[Metadata, Path], tuple[str, str | None]]


def _copy_request_metadata(request: PageSaveRequest) -> Metadata:
    """Validate the one native copy without replacing its open dictionary.

    Do not hoist this call before prepare_metadata's argument slot: copy()
    can replace that dependency, and Python must capture the original first.
    """
    copied_metadata: object = request.metadata.copy()
    assert is_record(copied_metadata)
    return copied_metadata


async def save_page(
    page_id: str,
    request: PageSaveRequest,
    background_tasks: BackgroundTasks,
    user_id: str | None,
    dependencies: SavePageDependencies,
) -> dict[str, object]:
    """Save a complete page while preserving optimistic concurrency."""
    file_path = await asyncio.to_thread(
        dependencies.find_page,
        page_id,
        allow_full_scan=False,
    )
    if file_path and file_path.exists() and request.expected_etag and not request.force:
        current_etag = dependencies.file_etag(file_path)
        if current_etag and current_etag != request.expected_etag:
            log.info(
                "etag mismatch for %s: expected=%s current=%s",
                page_id,
                request.expected_etag,
                current_etag,
            )
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "etag_mismatch",
                    "message": (
                        "The file has changed since you opened it, probably because "
                        "another device synchronized it. Reload it or resend with "
                        "force=true to overwrite it."
                    ),
                    "current_etag": current_etag,
                    "expected_etag": request.expected_etag,
                },
            )

    async with await dependencies.get_page_write_lock(page_id):
        metadata, table = dependencies.prepare_metadata(
            _copy_request_metadata(request),
            file_path,
        )
        metadata["id"] = page_id
        metadata["title"] = request.title
        if request.parent_id is not None:
            metadata["parent_id"] = request.parent_id
        if request.is_database:
            metadata["is_database"] = True
        if metadata.get("is_dashboard") is True:
            metadata.pop("content_format", None)

        file_path = dependencies.locate_file(
            page_id,
            request.title,
            metadata,
            file_path,
        )
        old_metadata, old_body = await asyncio.to_thread(
            dependencies.read_page,
            file_path,
        )
        previous_title = str(old_metadata.get("title") or "").strip()
        try:
            metadata = await asyncio.to_thread(
                dependencies.process_updates,
                page_id,
                old_metadata,
                metadata,
            )
        except Exception as exc:
            log.error("Error processing automations for %s: %s", page_id, exc)
        dependencies.stamp_author(metadata, user_id, not bool(old_metadata))
        metadata = dependencies.persist_assets(metadata)
        metadata = dependencies.ensure_citation_key(metadata, table)
        metadata = dependencies.dedupe_citation_key(metadata, page_id)

        try:
            await asyncio.to_thread(
                dependencies.write_with_version,
                page_id,
                file_path,
                metadata,
                request.content,
            )
            dependencies.refresh_page_index(file_path, metadata, request.content)
            dependencies.invalidate_page_responses()
            background_tasks.add_task(dependencies.update_link_index(), file_path)
            new_title = str(metadata.get("title") or request.title or "").strip()
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
                old_metadata,
                metadata,
                old_body,
                request.content,
            )
            folder, resolved_table_id = dependencies.resolve_page_context(
                metadata,
                file_path,
            )
            return {
                "status": "success",
                "id": page_id,
                "title": metadata.get("title", request.title),
                "metadata": metadata,
                "content": request.content,
                "folder": folder,
                "resolved_table_id": resolved_table_id,
                "etag": dependencies.file_etag(file_path),
                "message": "Page saved successfully",
            }
        except Exception as exc:
            log.error("Error saving page %s: %s", page_id, exc)
            raise HTTPException(
                status_code=500,
                detail="Error writing file to disk",
            ) from exc


__all__ = ["SavePageDependencies", "save_page"]
