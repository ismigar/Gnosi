"""Concurrency and short-lived caches for vault page operations."""

from __future__ import annotations

import asyncio
import time
from backend.domains.vault.pages.state import PreviewPayload, page_state
from backend.domains.vault.schemas.pages import PageInfo

# Page snapshots are versioned by the page index and explicitly invalidated by
# every Gnosi write.  Keep the derived value through the background-sync
# interval instead of rebuilding thousands of Pydantic models every 1.5 s.
PAGES_RESPONSE_CACHE_TTL = 600.0
PREVIEW_CACHE_MAX = 1000


async def get_page_write_lock(page_id: str) -> asyncio.Lock:
    """Return the process-local serialization lock for one page."""
    if page_state.write_locks_guard is None:
        page_state.write_locks_guard = asyncio.Lock()
    async with page_state.write_locks_guard:
        lock = page_state.write_locks.get(page_id)
        if lock is None:
            lock = asyncio.Lock()
            page_state.write_locks[page_id] = lock
        return lock


def get_cached_page_response(key: str) -> list[PageInfo] | None:
    """Return one non-expired page-response cache entry."""
    now = time.monotonic()
    with page_state.response_cache_lock:
        item = page_state.response_cache.get(key)
        if item is None:
            return None
        timestamp, value = item
        if now - timestamp > PAGES_RESPONSE_CACHE_TTL:
            page_state.response_cache.pop(key, None)
            return None
        return value


def set_cached_page_response(key: str, value: list[PageInfo]) -> None:
    """Store one page-response cache entry."""
    with page_state.response_cache_lock:
        page_state.response_cache[key] = (time.monotonic(), value)


def invalidate_page_responses() -> None:
    """Invalidate every derived page-list response."""
    with page_state.response_cache_lock:
        page_state.response_cache.clear()


def set_indexer_status(vault_key: str, **fields: object) -> None:
    """Merge fields into the background indexer status for one vault."""
    with page_state.indexer_status_lock:
        current = page_state.indexer_status_by_vault.setdefault(
            vault_key,
            {
                "state": "idle",
                "started_at": None,
                "finished_at": None,
                "files_indexed": 0,
                "error": None,
            },
        )
        current.update(fields)


def get_indexer_status(vault_key: str) -> dict[str, object]:
    """Return a detached status snapshot for one vault."""
    with page_state.indexer_status_lock:
        return dict(
            page_state.indexer_status_by_vault.get(
                vault_key,
                {
                    "state": "idle",
                    "started_at": None,
                    "finished_at": None,
                    "files_indexed": 0,
                    "error": None,
                },
            )
        )


def get_cached_preview(
    page_id: str,
    mtime: float,
    full: bool,
) -> PreviewPayload | None:
    """Return a matching short or full preview and refresh its LRU position."""
    with page_state.preview_cache_lock:
        cached = page_state.preview_cache.get(page_id)
        if not cached or cached.get("mtime") != mtime:
            return None
        page_state.preview_cache.move_to_end(page_id)
        value = cached.get("full" if full else "short")
        if not isinstance(value, dict):
            return None
        return value


def set_cached_preview(
    page_id: str,
    mtime: float,
    short: PreviewPayload,
    full: PreviewPayload,
) -> None:
    """Store both preview variants and enforce the LRU size limit."""
    with page_state.preview_cache_lock:
        if page_id in page_state.preview_cache:
            page_state.preview_cache.move_to_end(page_id)
        elif len(page_state.preview_cache) >= PREVIEW_CACHE_MAX:
            page_state.preview_cache.popitem(last=False)
        page_state.preview_cache[page_id] = {
            "mtime": mtime,
            "short": short,
            "full": full,
        }


def invalidate_cached_preview(page_id: str) -> None:
    """Drop one page preview after a mutation."""
    with page_state.preview_cache_lock:
        page_state.preview_cache.pop(page_id, None)


__all__ = [
    "PAGES_RESPONSE_CACHE_TTL",
    "PREVIEW_CACHE_MAX",
    "get_cached_page_response",
    "get_cached_preview",
    "get_indexer_status",
    "get_page_write_lock",
    "invalidate_cached_preview",
    "invalidate_page_responses",
    "set_cached_page_response",
    "set_cached_preview",
    "set_indexer_status",
]
