"""Single owner for per-vault plugin state and mutation locks."""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

PluginState = dict[str, Any]
NormalizeState = Callable[[Any], tuple[PluginState, bool]]


class JsonWriter(Protocol):
    def __call__(self, path: Path, payload: Any, **options: Any) -> None: ...


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

    def load(self) -> PluginState:
        with self.lock:
            try:
                path = self.dependencies.path()
                raw = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
                data, changed = self.dependencies.normalize_state(raw)
                if changed:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    self.dependencies.write_json(
                        path,
                        data,
                        indent=2,
                        ensure_ascii=False,
                    )
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
            path.parent.mkdir(parents=True, exist_ok=True)
            self.dependencies.write_json(
                path,
                payload,
                indent=2,
                ensure_ascii=False,
            )
        return payload


_store: PluginStateStore | None = None


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
