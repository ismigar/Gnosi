"""Single owner for per-vault plugin state and mutation locks."""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from collections import OrderedDict
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from backend.utils.safe_io import PathLike

PluginState = dict[str, Any]
NormalizeState = Callable[[Any], tuple[PluginState, bool]]


class JsonWriter(Protocol):
    def __call__(self, path: PathLike, obj: Any, **dumps_kwargs: Any) -> None: ...


@dataclass(frozen=True)
class PluginStateDependencies:
    path: Callable[[], Path]
    normalize_state: NormalizeState
    write_json: JsonWriter
    logger: logging.Logger


@dataclass
class PluginStateStore:
    dependencies: PluginStateDependencies
    lock: threading.Lock = field(default_factory=threading.Lock)
    mutation_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    _read_cache: OrderedDict[Path, tuple[tuple[int, int, int, int], PluginState]] = field(
        default_factory=OrderedDict, init=False, repr=False
    )

    def load(self) -> PluginState:
        with self.lock:
            try:
                path = self.dependencies.path()
                try:
                    stat = path.stat()
                    stamp = (stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size, stat.st_ino)
                except FileNotFoundError:
                    stamp = None
                cached = self._read_cache.get(path)
                if stamp is not None and cached is not None and cached[0] == stamp:
                    self._read_cache.move_to_end(path)
                    return deepcopy(cached[1])
                self._read_cache.pop(path, None)
                raw = json.loads(path.read_text(encoding="utf-8")) if stamp is not None else {}
                data, changed = self.dependencies.normalize_state(raw)
                if changed:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    self.dependencies.write_json(
                        path,
                        data,
                        indent=2,
                        ensure_ascii=False,
                    )
                elif stamp is not None:
                    # Check the file on every read so external permission changes
                    # remain visible; only reuse decoding and normalization.
                    self._read_cache[path] = (stamp, deepcopy(data))
                    while len(self._read_cache) > 16:
                        self._read_cache.popitem(last=False)
                return data
            except Exception as exc:
                self.dependencies.logger.warning(
                    "Could not load plugin state; using core-only defaults: %s",
                    exc,
                )
                data, _ = self.dependencies.normalize_state({})
                return data

    def save(self, state: PluginState) -> PluginState:
        """Persist normalized plugin state without compatibility-field loss."""
        payload, _ = self.dependencies.normalize_state(state)
        with self.lock:
            path = self.dependencies.path()
            self._read_cache.pop(path, None)
            path.parent.mkdir(parents=True, exist_ok=True)
            self.dependencies.write_json(
                path,
                payload,
                indent=2,
                ensure_ascii=False,
            )
        return payload


_store: PluginStateStore | None = None
_bootstrap_lock = threading.Lock()


def configure(dependencies: PluginStateDependencies) -> None:
    """Create the process-wide state owner from the composition facade."""
    global _store
    if _store is not None:
        raise RuntimeError("Plugin state is already configured")
    _store = PluginStateStore(dependencies)


def store() -> PluginStateStore:
    if _store is None:
        raise RuntimeError("Plugin state has not been configured")
    return _store


def load_with_dependencies(dependencies: PluginStateDependencies) -> PluginState:
    """Load state without requiring the HTTP composition root to be imported.

    Once the process-wide store exists, it remains the single synchronized
    owner. During early non-HTTP startup, a short-lived store provides the same
    normalization and persistence behavior behind a bootstrap lock.
    """
    current = _store
    if current is not None:
        return current.load()
    with _bootstrap_lock:
        current = _store
        if current is not None:
            return current.load()
        return PluginStateStore(dependencies).load()
