"""Read-only HTTP adapters for vault pages and previews."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.params import Depends as DependsParameter

from backend.domains.vault.schemas.pages import (
    BulkPreviewWarmResponse,
    PageDetailResponse,
    PageInfo,
    PagePreviewResponse,
    SidebarPageInfo,
    TablePagesSnapshot,
    _BulkWarmPayload,
)

log = logging.getLogger(__name__)


class SnapshotReader(Protocol):
    def __call__(
        self,
        only_calendar: bool = False,
        background_tasks: BackgroundTasks | None = None,
    ) -> list[PageInfo]: ...


class PageFinder(Protocol):
    def __call__(
        self,
        page_id: str,
        *,
        allow_full_scan: bool = True,
    ) -> Path | None: ...


@dataclass(frozen=True)
class PageQueryDependencies:
    """Narrow read operations required by page query endpoints."""

    get_pages_snapshot: SnapshotReader
    page_index_cache_path: Callable[[], Path | None]
    get_pages_for_table: Callable[[str], list[PageInfo]]
    enrich_table_pages: Callable[[str, list[PageInfo]], None]
    visible_table_pages: Callable[[str, list[PageInfo]], list[PageInfo]]
    active_vault_path: Callable[[], Path | None]
    get_indexer_status: Callable[[str], dict[str, Any]]
    cached_entry_count: Callable[[str], int]
    find_page: PageFinder
    materialize_page: Callable[[Path, str], Awaitable[None]]
    read_dashboard: Callable[[Path], tuple[dict[str, Any], str]]
    is_dashboard: Callable[[Path], bool]
    parse_frontmatter: Callable[[str, Path | None], tuple[dict[str, Any], str]]
    enrich_single_page: Callable[
        [dict[str, Any], str, Path],
        tuple[dict[str, Any], str, str | None],
    ]
    file_etag: Callable[[Path], str]
    fetch_preview: Callable[
        [Path, str],
        Awaitable[tuple[dict[str, Any], dict[str, Any], float]],
    ]
    warm_preview: Callable[[str], Awaitable[str]]
    preview_concurrency: int
    preview_timeout_seconds: float


_dependencies: PageQueryDependencies | None = None


def configure(dependencies: PageQueryDependencies) -> None:
    global _dependencies
    if _dependencies is not None and _dependencies != dependencies:
        raise RuntimeError("Vault page query API is already configured")
    _dependencies = dependencies


def _deps() -> PageQueryDependencies:
    if _dependencies is None:
        raise RuntimeError("Vault page query API has not been configured")
    return _dependencies


async def list_pages(
    background_tasks: BackgroundTasks,
    only_calendar: bool = Query(False),
    folder: str | None = Query(
        None,
        description="If provided, only pages whose folder starts with this prefix are returned.",
    ),
    limit: int | None = Query(
        None,
        ge=1,
        le=10000,
        description="Maximum number of pages to return. Default: no limit.",
    ),
    offset: int = Query(0, ge=0),
) -> list[PageInfo]:
    """Lists all pages in the root flatly by iterating through UUID.md files.
    Returns cached data instantly and triggers a background refresh.

    The vault can hold thousands of pages (calendar events, mail metadata,
    test fixtures…). Without `folder`/`limit`/`offset` filters, naive callers
    get the full snapshot — useful for the sidebar tree, expensive otherwise.
    """
    dependencies = _deps()
    pages = await asyncio.to_thread(
        dependencies.get_pages_snapshot,
        only_calendar=only_calendar,
        background_tasks=background_tasks,
    )
    if not pages and not folder and offset == 0:
        try:
            cache_path = dependencies.page_index_cache_path()
            if cache_path and cache_path.exists() and cache_path.stat().st_size > 2:
                raise HTTPException(
                    status_code=503,
                    detail="Page index is warming up; retry shortly.",
                    headers={"Retry-After": "2"},
                )
        except HTTPException:
            raise
        except OSError:
            pass
    if folder:
        prefix = folder.strip("/")
        pages = [page for page in pages if (page.folder or "").startswith(prefix)]
    if limit is not None:
        pages = pages[offset : offset + limit]
    elif offset:
        pages = pages[offset:]
    return pages


async def list_pages_by_table(
    table_id: str,
    include_templates: bool = Query(True),
) -> list[PageInfo]:
    """Returns only pages from a specific table to avoid loading the entire Vault.

    Fast-path via `_get_pages_for_table`: `PageInfo` is only built for
    the entries of the requested table, not for the ~4200 of the entire vault
    (saving ~1s/call). Before, moreover, there was a RESIDUAL call to
    `_get_pages_by_table_id` (the previous per-table index mechanism) whose
    result was discarded on the following line: since its
    cache was invalidated on every version bump (every PATCH/create), the first
    call after an edit would rebuild the index for ALL tables just to throw it away.
    """
    dependencies = _deps()
    pages = await asyncio.to_thread(dependencies.get_pages_for_table, table_id)
    if not include_templates:
        pages = [page for page in pages if not page.metadata.get("is_template")]
    await asyncio.to_thread(dependencies.enrich_table_pages, table_id, pages)
    return pages


async def list_pages_by_table_snapshot(table_id: str) -> TablePagesSnapshot:
    """Returns canonical snapshot per table: raw + real visible.

    This route avoids divergences between frontend sessions and establishes
     a single source of truth for the count of visible records.
    """
    dependencies = _deps()
    raw_pages = await asyncio.to_thread(dependencies.get_pages_for_table, table_id)
    visible_pages = dependencies.visible_table_pages(table_id, raw_pages)
    await asyncio.to_thread(
        dependencies.enrich_table_pages,
        table_id,
        visible_pages,
    )
    return TablePagesSnapshot(
        table_id=table_id,
        raw_count=len(raw_pages),
        visible_count=len(visible_pages),
        pages=visible_pages,
    )


async def get_indexer_status_endpoint() -> dict[str, Any]:
    """Expose the page-index warmup status so the UI can show 'indexing…'.

    States:
      - idle:    no indexing has been requested yet
      - running: warmup in progress (UI may still receive partial results
                 from the cache; full scan ongoing)
      - ready:   index is complete and serving requests
      - error:   warmup failed (see `error`)
    """
    dependencies = _deps()
    vault_path = dependencies.active_vault_path()
    if not vault_path:
        return {"state": "no_vault", "files_indexed": 0}
    vault_key = str(vault_path)
    status = dependencies.get_indexer_status(vault_key)
    status["cached_entries"] = dependencies.cached_entry_count(vault_key)
    return status


async def list_sidebar_summary() -> list[SidebarPageInfo]:
    """Returns a lightweight summary of pages for the sidebar."""
    return [
        SidebarPageInfo(
            id=page.id,
            title=page.title,
            parent_id=page.parent_id,
            is_database=page.is_database,
            metadata=page.metadata,
            last_modified=page.last_modified,
            folder=page.folder,
            resolved_table_id=page.resolved_table_id,
        )
        for page in _deps().get_pages_snapshot()
    ]


async def get_page(page_id: str) -> dict[str, object]:
    """Returns the full content of a page by ID."""
    dependencies = _deps()
    file_path = await asyncio.to_thread(dependencies.find_page, page_id)
    if not file_path or not file_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Page not found (ID: {page_id})",
        )
    await dependencies.materialize_page(file_path, page_id)

    def _read_and_parse() -> tuple[dict[str, Any], str]:
        if dependencies.is_dashboard(file_path):
            return dependencies.read_dashboard(file_path)
        delays = [0.05, 0.1, 0.2, 0.4, 0.8, 1.0, 1.0, 1.0]
        last_error: OSError | None = None
        for attempt in range(len(delays) + 1):
            try:
                raw_content = file_path.read_text(encoding="utf-8")
                return dependencies.parse_frontmatter(raw_content, file_path)
            except OSError as exc:
                last_error = exc
                if exc.errno == 35 and attempt < len(delays):
                    time.sleep(delays[attempt])
                    continue
                raise
        if last_error:
            raise last_error
        return {}, ""

    try:
        metadata, body = await asyncio.to_thread(_read_and_parse)
        metadata, folder, table_id = dependencies.enrich_single_page(
            metadata,
            page_id,
            file_path,
        )
        return {
            "id": str(metadata.get("id") or page_id),
            "title": metadata.get("title", ""),
            "metadata": metadata,
            "content": body.strip(),
            "folder": folder,
            "resolved_table_id": table_id,
            "etag": dependencies.file_etag(file_path),
        }
    except Exception as exc:
        log.error("Error reading page %s: %s", page_id, exc)
        raise HTTPException(status_code=500, detail="Error reading target file") from exc


async def get_page_preview(page_id: str, full: bool = False) -> dict[str, Any]:
    """Preview of a page (title + excerpt/body + icon/cover + images).

    By default returns only `excerpt` (for wikilink tooltips).
    With `?full=true`, it also returns `body_md` (full markdown for rendering
    in the feed) and `images` (list of image URLs from the body).

    In-memory cache invalidated by mtime + in-flight dedup per id:
      - The first call pays the real cost (warmup + read + parse, ~ms if
        already local, ~seconds if still online-only).
      - Subsequent calls are instantaneous until the .md is modified.
      - If two concurrent requests ask for the same id, they share
        the same work (not duplicated).

    OneDrive's Errno 35 degrades to empty (preview is not critical).
    """
    dependencies = _deps()
    file_path = await asyncio.to_thread(dependencies.find_page, page_id)
    if not file_path or not file_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Page not found (ID: {page_id})",
        )
    try:
        short, full_response, _ = await dependencies.fetch_preview(file_path, page_id)
        return full_response if full else short
    except OSError as exc:
        if exc.errno == 35:
            response: dict[str, Any] = {
                "id": page_id,
                "title": "",
                "excerpt": "",
                "icon": None,
                "cover": None,
            }
            if full:
                response["body_md"] = ""
                response["images"] = []
            return response
        log.error("Error reading preview for page %s: %s", page_id, exc)
        raise HTTPException(status_code=500, detail="Error reading preview") from exc
    except Exception as exc:
        log.error("Error generating preview for %s: %s", page_id, exc)
        raise HTTPException(
            status_code=500,
            detail="Error generating page preview",
        ) from exc


async def bulk_warm_previews(payload: _BulkWarmPayload) -> dict[str, int]:
    """Parallel pre-warmup of previews for a list of ids.

    Use case: the frontend, when mounting a view (feed/table/gallery) with
    dozens of items, calls this endpoint once with all the ids. The
    backend triggers OneDrive warmup + read + parse + cache for each item
    in parallel (limited concurrency). The individual `/preview`
    requests the frontend makes afterward will be instantaneous (cache
    hit) instead of waiting ~5s each.

    Robust against:
      - **Orphan/stale ids** (pointing to already-deleted files):
        `allow_full_scan=False` avoids a full vault rglob for each one
        — a single deleted id doesn't block the whole batch.
      - **Slow/stuck materializations**: per-item timeout
        (`_PREVIEW_WARM_PER_ITEM_TIMEOUT_S`). The daemon has its own
        timeout but this is its upper bound at the backend.
      - **Individual errors**: each warmup fails silently (`failed += 1`);
        never propagates to the batch or changes the HTTP status.
      - **Concurrent calls**: in-flight dedup per id (see
        `_bulk_warm_one`).

    Returns counters: total requested, cached (skip), successfully
    warmed, failed.
    """
    dependencies = _deps()
    page_ids = list(dict.fromkeys(payload.ids or []))
    if not page_ids:
        return {"requested": 0, "cached": 0, "warmed": 0, "failed": 0}
    semaphore = asyncio.Semaphore(dependencies.preview_concurrency)

    async def _bounded(page_id: str) -> str:
        async with semaphore:
            try:
                return await asyncio.wait_for(
                    dependencies.warm_preview(page_id),
                    timeout=dependencies.preview_timeout_seconds,
                )
            except TimeoutError:
                log.warning(
                    "bulk warmup timeout per %s (>%ss)",
                    page_id,
                    dependencies.preview_timeout_seconds,
                )
                return "failed"
            except Exception as exc:
                log.debug("bulk warmup outer failed for %s: %s", page_id, exc)
                return "failed"

    results = await asyncio.gather(*[_bounded(page_id) for page_id in page_ids])
    return {
        "requested": len(page_ids),
        "cached": results.count("cached"),
        "warmed": results.count("warmed"),
        "failed": results.count("failed"),
    }


def register_catalog_routes(router: APIRouter) -> None:
    router.add_api_route(
        "/pages",
        list_pages,
        methods=["GET"],
        response_model=list[PageInfo],
    )
    router.add_api_route(
        "/pages/by-table/{table_id}",
        list_pages_by_table,
        methods=["GET"],
        response_model=list[PageInfo],
    )
    router.add_api_route(
        "/pages/by-table/{table_id}/snapshot",
        list_pages_by_table_snapshot,
        methods=["GET"],
        response_model=TablePagesSnapshot,
    )


def register_status_routes(router: APIRouter) -> None:
    router.add_api_route(
        "/indexer-status",
        get_indexer_status_endpoint,
        methods=["GET"],
        response_model=None,
    )
    router.add_api_route(
        "/sidebar/summary",
        list_sidebar_summary,
        methods=["GET"],
        response_model=list[SidebarPageInfo],
    )


def register_page_route(router: APIRouter) -> None:
    router.add_api_route(
        "/pages/{page_id}",
        get_page,
        methods=["GET"],
        response_model=PageDetailResponse,
    )


def register_preview_routes(router: APIRouter) -> None:
    router.add_api_route(
        "/pages/{page_id}/preview",
        get_page_preview,
        methods=["GET"],
        response_model=PagePreviewResponse,
    )
    router.add_api_route(
        "/pages/preview/warm",
        bulk_warm_previews,
        methods=["POST"],
        response_model=BulkPreviewWarmResponse,
    )


__all__ = [
    "PageQueryDependencies",
    "bulk_warm_previews",
    "configure",
    "get_indexer_status_endpoint",
    "get_page",
    "get_page_preview",
    "list_pages",
    "list_pages_by_table",
    "list_pages_by_table_snapshot",
    "list_sidebar_summary",
    "register_catalog_routes",
    "register_page_route",
    "register_preview_routes",
    "register_status_routes",
]
