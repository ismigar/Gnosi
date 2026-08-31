"""Single in-process state owner for vault page operations."""

from __future__ import annotations

import asyncio
import threading
from collections import OrderedDict
from typing import TYPE_CHECKING, TypedDict

if TYPE_CHECKING:
    from backend.domains.vault.pages.index_entries import PageCacheEntry
    from backend.domains.vault.schemas.pages import PageInfo


PreviewPayload = dict[str, object]
PreviewDocument = tuple[PreviewPayload, PreviewPayload, float]


class PreviewCacheEntry(TypedDict, total=False):
    """Internal envelope; payload values remain open and retain their identity."""

    mtime: float
    short: PreviewPayload
    full: PreviewPayload


class PageState:
    """Mutable page state shared by the legacy facade and domain services."""

    def __init__(self) -> None:
        self.index_lock = threading.Lock()
        self.index_entries: dict[str, dict[str, PageCacheEntry]] = {}
        self.index_initialized: dict[str, bool] = {}
        self.id_to_path: dict[str, dict[object, str]] = {}
        self.index_version: dict[str, int] = {}
        self.last_vault_sync_time = 0.0

        self.response_cache_lock = threading.Lock()
        self.response_cache: dict[str, tuple[float, list[PageInfo]]] = {}

        self.write_locks: dict[str, asyncio.Lock] = {}
        self.write_locks_guard: asyncio.Lock | None = None

        self.indexer_status_lock = threading.Lock()
        self.indexer_status_by_vault: dict[str, dict[str, object]] = {}

        self.preview_cache_lock = threading.Lock()
        self.preview_cache: OrderedDict[str, PreviewCacheEntry] = OrderedDict()
        self.preview_inflight: dict[str, asyncio.Future[PreviewDocument]] = {}
        self.preview_inflight_lock = threading.Lock()

        self.last_stale_check: dict[str, float] = {"ts": 0.0}
        self.user_label_cache: dict[str, str] = {}


page_state: PageState = PageState()

__all__ = ["PageState", "PreviewCacheEntry", "PreviewDocument", "PreviewPayload", "page_state"]
