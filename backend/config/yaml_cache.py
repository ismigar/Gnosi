"""Reuse decoded configuration while checking the file on every read."""

from __future__ import annotations

import os
import threading
from collections import OrderedDict
from concurrent.futures import Future
from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml

Document = dict[str, Any]
Stamp = tuple[int, int, int, int, int, int]
Key = tuple[Path, type[Any]]


def _stamp(stat: os.stat_result) -> Stamp:
    return (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_mode)


class ConfigYamlCache:
    """Coalesce concurrent reads per file without locking unrelated vaults."""

    def __init__(self, max_entries: int = 16, max_file_bytes: int = 1_048_576) -> None:
        self._max_entries = max_entries
        self._max_file_bytes = max_file_bytes
        self._guard = threading.Lock()
        self._entries: OrderedDict[Key, tuple[Stamp, Document]] = OrderedDict()
        self._pending: dict[Key, Future[None]] = {}

    def read(self, path: Path, loader: type[Any]) -> Document:
        # Preserve symlink/.. semantics; resolving the path itself can be a
        # slow cloud-filesystem walk and is unnecessary for freshness checks.
        path = path if path.is_absolute() else Path.cwd() / path
        key = (path, loader)
        while True:
            try:
                stamp = _stamp(path.stat())
            except OSError:
                with self._guard:
                    self._entries.pop(key, None)
                raise
            with self._guard:
                hit = self._entries.get(key)
                if hit is not None and hit[0] == stamp:
                    self._entries.move_to_end(key)
                    document = hit[1]
                else:
                    document = None
                    self._entries.pop(key, None)
                    pending = self._pending.get(key)
                    owner = pending is None
                    if pending is None:
                        pending = Future()
                        self._pending[key] = pending
            if document is not None:
                return deepcopy(document)
            assert pending is not None
            if owner:
                break
            # A shared read is finished, but the file may have changed during
            # it. Check its current identity again instead of reusing its result.
            pending.result()

        try:
            with path.open("r", encoding="utf-8") as handle:
                opened = _stamp(os.fstat(handle.fileno()))
                loaded = yaml.load(handle, Loader=loader)
                finished = _stamp(os.fstat(handle.fileno()))
            document = loaded if isinstance(loaded, dict) else {}
            # An atomic replacement, in-place edit or permission change during
            # the read must not publish a reusable entry for a different file.
            if opened == finished == _stamp(path.stat()) and opened[2] <= self._max_file_bytes:
                stored = deepcopy(document)
                with self._guard:
                    self._entries[key] = (opened, stored)
                    self._entries.move_to_end(key)
                    while len(self._entries) > self._max_entries:
                        self._entries.popitem(last=False)
            return document
        except BaseException as error:
            pending.set_exception(error)
            raise
        finally:
            with self._guard:
                if self._pending.get(key) is pending:
                    self._pending.pop(key)
            if not pending.done():
                pending.set_result(None)
