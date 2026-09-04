"""Thread-safe cache for sanitized configuration responses."""

from __future__ import annotations

import copy
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar


ConfigDocument = dict[str, object]
ResultT = TypeVar("ResultT")


@dataclass(frozen=True)
class _CacheEntry:
    document: ConfigDocument
    expires_at: float
    generation: int


class ConfigResponseCache:
    """Cache sanitized documents and serialize readers/writers per vault."""

    def __init__(self, ttl_seconds: float = 30.0) -> None:
        self._ttl_seconds = ttl_seconds
        self._guard = threading.Lock()
        self._entries: dict[str, _CacheEntry] = {}
        self._generations: dict[str, int] = {}
        self._key_locks: dict[str, threading.Lock] = {}

    def _key_lock(self, key: str) -> threading.Lock:
        with self._guard:
            return self._key_locks.setdefault(key, threading.Lock())

    def _cached(self, key: str, now: float) -> ConfigDocument | None:
        with self._guard:
            entry = self._entries.get(key)
            generation = self._generations.get(key, 0)
            if entry is None or entry.expires_at <= now or entry.generation != generation:
                self._entries.pop(key, None)
                return None
            return copy.deepcopy(entry.document)

    def get_or_load(
        self,
        key: str,
        loader: Callable[[], ConfigDocument],
    ) -> ConfigDocument:
        """Return a defensive copy, coalescing concurrent cache misses."""
        cached = self._cached(key, time.monotonic())
        if cached is not None:
            return cached

        with self._key_lock(key):
            cached = self._cached(key, time.monotonic())
            if cached is not None:
                return cached
            with self._guard:
                generation = self._generations.get(key, 0)
            document = loader()
            stored = copy.deepcopy(document)
            with self._guard:
                if self._generations.get(key, 0) == generation:
                    self._entries[key] = _CacheEntry(
                        document=stored,
                        expires_at=time.monotonic() + self._ttl_seconds,
                        generation=generation,
                    )
            return copy.deepcopy(document)

    def update(self, key: str, operation: Callable[[], ResultT]) -> ResultT:
        """Run a write after in-flight reads, then invalidate its cache entry."""
        with self._key_lock(key):
            try:
                return operation()
            finally:
                # Credential migration can succeed before a later YAML write
                # fails. Never retain a response assembled before that attempt.
                self.invalidate(key)

    def invalidate(self, key: str | None = None) -> None:
        """Invalidate one vault or every cached document."""
        with self._guard:
            if key is None:
                keys = set(self._entries) | set(self._generations)
                for current in keys:
                    self._generations[current] = self._generations.get(current, 0) + 1
                self._entries.clear()
                return
            self._generations[key] = self._generations.get(key, 0) + 1
            self._entries.pop(key, None)

    def clear(self) -> None:
        """Reset mutable state for process teardown and isolated tests."""
        with self._guard:
            self._entries.clear()
            self._generations.clear()
            self._key_locks.clear()
