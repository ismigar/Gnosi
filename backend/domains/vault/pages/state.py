"""Single in-process state owner for vault page operations."""

from __future__ import annotations

import asyncio
import threading
from collections import OrderedDict
from typing import Any


PreviewDocument = tuple[dict[str, Any], dict[str, Any], float]


class PageState:
    """Mutable page state shared by the legacy facade and domain services."""

    def __init__(self) -> None:
        self.index_lock = threading.Lock()
        self.index_entries: dict[str, dict[str, dict[str, Any]]] = {}
        self.index_initialized: dict[str, bool] = {}
        self.id_to_path: dict[str, dict[str, str]] = {}
        self.index_version: dict[str, int] = {}
        self.last_vault_sync_time = 0.0

        self.response_cache_lock = threading.Lock()
        self.response_cache: dict[str, tuple[float, list[Any]]] = {}

        self.write_locks: dict[str, asyncio.Lock] = {}
        self.write_locks_guard: asyncio.Lock | None = None

        self.indexer_status_lock = threading.Lock()
        self.indexer_status_by_vault: dict[str, dict[str, Any]] = {}

        self.preview_cache_lock = threading.Lock()
        self.preview_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self.preview_inflight: dict[str, asyncio.Future[PreviewDocument]] = {}
        self.preview_inflight_lock = threading.Lock()

        self.last_stale_check: dict[str, float] = {"ts": 0.0}
        self.user_label_cache: dict[str, str] = {}


page_state = PageState()

__all__ = ["PageState", "PreviewDocument", "page_state"]
