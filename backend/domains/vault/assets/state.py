"""Single owners for mutable vault-asset state."""

from __future__ import annotations

import json
import threading
from collections.abc import Callable, Sequence
from pathlib import Path


def normalize_custom_icons(values: object, limit: int = 100) -> list[str]:
    """Normalize the persisted icon list without changing its legacy rules."""
    if not isinstance(values, list):
        return []

    seen: set[str] = set()
    normalized: list[str] = []
    for raw in values:
        if not isinstance(raw, str):
            continue
        icon = raw.strip()
        if not icon or len(icon) > 2048 or icon in seen:
            continue
        seen.add(icon)
        normalized.append(icon)
        if len(normalized) >= limit:
            break
    return normalized


class CustomIconStore:
    """Own the custom-icon lock and atomic persistence boundary."""

    def __init__(
        self,
        path_provider: Callable[[], Path],
        json_writer: Callable[[Path, object], None],
    ) -> None:
        self._path_provider = path_provider
        self._json_writer = json_writer
        self._lock = threading.Lock()

    @property
    def lock(self) -> threading.Lock:
        """Expose the historical lock only for the compatibility facade."""
        return self._lock

    def path(self) -> Path:
        """Return the active vault's custom-icon file."""
        return self._path_provider()

    def load(self) -> list[str]:
        """Load the normalized custom icon collection."""
        with self._lock:
            try:
                path = self.path()
                if not path.exists():
                    return []
                raw: object = json.loads(path.read_text(encoding="utf-8"))
                return normalize_custom_icons(raw, limit=100)
            except Exception:
                return []

    def save(self, values: Sequence[str]) -> list[str]:
        """Persist normalized custom icons atomically."""
        normalized = normalize_custom_icons(list(values), limit=100)
        with self._lock:
            path = self.path()
            path.parent.mkdir(parents=True, exist_ok=True)
            self._json_writer(path, normalized)
        return normalized


__all__ = ["CustomIconStore", "normalize_custom_icons"]
