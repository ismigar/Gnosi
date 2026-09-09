"""Briefly reuse successful directory preparation, never content or access checks."""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import Future
from pathlib import Path


class DirectoryPreparationCache:
    """Bound successful checks by path and share overlapping preparations."""

    def __init__(
        self,
        ttl_seconds: float = 30.0,
        max_entries: int = 256,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl_seconds = ttl_seconds
        self._max_entries = max_entries
        self._clock = clock
        self._guard = threading.Lock()
        self._successful: OrderedDict[Path, float] = OrderedDict()
        self._pending: dict[Path, Future[None]] = {}

    def invalidate(self, path: Path) -> None:
        """An explicit fresh preparation supersedes cached and in-flight checks."""
        with self._guard:
            self._successful.pop(path, None)
            self._pending.pop(path, None)

    def ensure(self, path: Path, prepare: Callable[[Path], None]) -> None:
        with self._guard:
            checked_at = self._successful.get(path)
            if checked_at is not None and self._clock() - checked_at < self._ttl_seconds:
                self._successful.move_to_end(path)
                return
            self._successful.pop(path, None)
            pending = self._pending.get(path)
            owner = pending is None
            if pending is None:
                pending = Future()
                self._pending[path] = pending
        if not owner:
            pending.result()
            return
        try:
            prepare(path)
            with self._guard:
                if self._pending.get(path) is pending:
                    self._successful[path] = self._clock()
                    self._successful.move_to_end(path)
                    while len(self._successful) > self._max_entries:
                        self._successful.popitem(last=False)
            pending.set_result(None)
        except BaseException as error:
            pending.set_exception(error)
            raise
        finally:
            with self._guard:
                if self._pending.get(path) is pending:
                    self._pending.pop(path)
