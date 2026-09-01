"""Thread-safe in-memory cache with TTL and bounded size.

Why bounded + locked:
    - The previous version used a plain dict mutated from both async handlers
      and threadpool callbacks (e.g. `run_in_executor` in mail/contacts
      routes). CPython's GIL makes a single `dict[k]=v` look atomic, but
      compound sequences (`pop` + `set`, snapshot iteration, `clear` mid
      `get_or_set`) are real race conditions that could leak partial state.
    - The previous version had no eviction. `_MAIL_CACHE`, `_COUNTS_CACHE`,
      `_contacts_cache` grew without bound — each new search query / inbox
      / workspace combination added an entry that was never evicted. Long-
      running processes accumulated tens of MB of stale cache.

This module is the single source of truth for in-process caches. Don't
introduce new bespoke `_FOO_CACHE = {}` modules without a strong reason.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Dict, Optional


class SimpleCache:
    """A thread-safe in-memory cache with TTL and LRU eviction.

    Methods are individually thread-safe. For atomic read-modify-write,
    prefer `get_or_set`.
    """

    def __init__(self, default_ttl: int = 300, max_size: int = 1024):
        # OrderedDict gives us O(1) move-to-end on access for LRU.
        self._cache: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
        self.default_ttl = default_ttl
        self.max_size = max_size
        self._lock = threading.Lock()

    def _evict_expired_locked(self) -> None:
        """Drop expired entries. Caller must hold the lock."""
        now = time.time()
        # Iterate over a snapshot of keys to allow deletion during iteration.
        for k in list(self._cache.keys()):
            if self._cache[k]["expiry"] <= now:
                self._cache.pop(k, None)

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None
            if time.time() > entry["expiry"]:
                self._cache.pop(key, None)
                return None
            # LRU touch.
            self._cache.move_to_end(key)
            return entry["value"]

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        expiry = time.time() + (ttl if ttl is not None else self.default_ttl)
        with self._lock:
            self._cache[key] = {"value": value, "expiry": expiry}
            self._cache.move_to_end(key)
            # LRU eviction — drop the oldest until under the bound.
            while len(self._cache) > self.max_size:
                self._cache.popitem(last=False)

    def pop(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._cache.pop(key, None)
            if entry is None:
                return None
            return entry["value"]

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()

    def get_or_set(
        self,
        key: str,
        func: Callable[[], Any],
        ttl: Optional[int] = None,
    ) -> Any:
        # Fast path: hit (no compute, no recompute under lock).
        value = self.get(key)
        if value is not None:
            return value
        # Compute outside the lock — `func` may be slow (network, disk).
        # Multiple concurrent callers may compute the same key once each
        # (acceptable trade-off vs. holding the lock for seconds).
        value = func()
        self.set(key, value, ttl)
        return value

    def __len__(self) -> int:
        with self._lock:
            return len(self._cache)


# Global default instance for shared use. Its bounds are conservative;
# callers needing different sizes should instantiate their own SimpleCache.
global_cache = SimpleCache(default_ttl=300, max_size=512)
