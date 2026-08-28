"""Shared mutable state for federated literature workflows."""

from __future__ import annotations

import asyncio
import threading
from typing import Any

_CONFIG_LOCK = threading.RLock()


_SEARCH_LOCK = threading.RLock()


_INDEX_LOCK = threading.RLock()


_IMPORT_LOCK = threading.RLock()


_SEARCH_TASKS: dict[str, asyncio.Task[Any]] = {}


_SYNC_THREADS: dict[str, threading.Thread] = {}


_REVIEW_THREADS: dict[str, threading.Thread] = {}


MAX_SEARCH_RESULTS = 1_000


MAX_EVENTS = 2_000
