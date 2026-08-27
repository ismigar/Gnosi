"""Single owners for mutable vault-file state."""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import threading
from collections.abc import Callable, Mapping
from pathlib import Path

log = logging.getLogger(__name__)


class FileServingState:
    """Own the process-wide read semaphore used by streamed vault files."""

    def __init__(self, concurrency: int = 3) -> None:
        self.semaphore = asyncio.Semaphore(concurrency)


class LocalLinkStore:
    """Own local-file tokens, their lock, and atomic JSON persistence."""

    def __init__(self, data_dir: Callable[[], Path]) -> None:
        self._data_dir = data_dir
        self._lock = threading.Lock()

    @property
    def lock(self) -> threading.Lock:
        """Expose the historical lock only for the compatibility facade."""
        return self._lock

    def path(self) -> Path:
        """Resolve the local-only mapping lazily."""
        return self._data_dir() / "local_file_links.json"

    def _load_unlocked(self) -> dict[str, str]:
        path = self.path()
        if not path.exists():
            return {}
        try:
            raw: object = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("Could not read %s: %s", path, exc)
            return {}
        if not isinstance(raw, dict):
            return {}
        return {
            key: value
            for key, value in raw.items()
            if isinstance(key, str) and isinstance(value, str)
        }

    def _save_unlocked(self, mapping: Mapping[str, str]) -> None:
        path = self.path()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(".tmp")
            temporary.write_text(
                json.dumps(dict(mapping), indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            temporary.replace(path)
        except OSError as exc:
            log.error("Could not persist local links to %s: %s", path, exc)

    def snapshot(self) -> dict[str, str]:
        """Return a safe copy of all token mappings."""
        with self._lock:
            return self._load_unlocked()

    def replace(self, mapping: Mapping[str, str]) -> None:
        """Persist a complete mapping under the canonical lock."""
        with self._lock:
            self._save_unlocked(mapping)

    def get(self, token: str) -> str | None:
        """Resolve one opaque token."""
        with self._lock:
            return self._load_unlocked().get(token)

    def token_for(self, absolute_path: str) -> str:
        """Reuse an existing token or persist a new opaque token."""
        with self._lock:
            mapping = self._load_unlocked()
            existing = next(
                (token for token, value in mapping.items() if value == absolute_path),
                None,
            )
            if existing is not None:
                return existing
            token = secrets.token_urlsafe(16)
            mapping[token] = absolute_path
            self._save_unlocked(mapping)
            return token

    def remove(self, token: str) -> None:
        """Remove one token if it exists."""
        with self._lock:
            mapping = self._load_unlocked()
            if token in mapping:
                del mapping[token]
                self._save_unlocked(mapping)


file_serving_state = FileServingState()


__all__ = ["FileServingState", "LocalLinkStore", "file_serving_state"]
