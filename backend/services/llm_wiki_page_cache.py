"""Persistent local disk cache for synchronized LLM Wiki page sidecars.

Sidecar files live inside the vault (often on cloud-backed storage such as
OneDrive), so cold-start reads through coordinated file snapshots can take
minutes across thousands of pages.  This module mirrors ``(mtime_ns, size)``
validated entries into ``local_root()`` so unchanged sidecars are served
directly after a restart without spawning file-access subprocesses.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

from backend.utils.safe_io import safe_write_json

CACHE_FILENAME = "page-state-cache.json"
CACHE_VERSION = 1

PageStateEntry = tuple[int, int, dict[str, object]]

_GUARD = threading.RLock()
_LOADED_PATHS: set[str] = set()
_DIRTY_COUNTS: dict[str, int] = {}


def load_into(cache_path: Path, target: dict[str, PageStateEntry]) -> None:
    """Hydrate ``target`` once per ``cache_path`` from the local disk cache."""
    key = str(cache_path)
    with _GUARD:
        if key in _LOADED_PATHS:
            return
        _LOADED_PATHS.add(key)
    try:
        if not cache_path.exists():
            return
        raw = json.loads(cache_path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return
    if not isinstance(raw, dict) or raw.get("version") != CACHE_VERSION:
        return
    entries = raw.get("entries")
    if not isinstance(entries, dict):
        return
    parsed: dict[str, PageStateEntry] = {}
    for path_key, entry in entries.items():
        if (
            isinstance(path_key, str)
            and isinstance(entry, list)
            and len(entry) == 3
            and isinstance(entry[0], int)
            and isinstance(entry[1], int)
            and isinstance(entry[2], dict)
            and all(isinstance(k, str) for k in entry[2])
        ):
            parsed[path_key] = (entry[0], entry[1], dict(entry[2]))
    if not parsed:
        return
    with _GUARD:
        for path_key, value in parsed.items():
            target.setdefault(path_key, value)


def mark_dirty(cache_path: Path, *, threshold: int = 64) -> bool:
    """Record one cache mutation and return True when a periodic flush is due."""
    key = str(cache_path)
    with _GUARD:
        count = _DIRTY_COUNTS.get(key, 0) + 1
        _DIRTY_COUNTS[key] = count
        return count >= threshold


def flush(
    cache_path: Path,
    source: dict[str, PageStateEntry],
    *,
    prefix: str = "",
    force: bool = False,
) -> None:
    """Persist ``source`` entries for this vault to ``cache_path`` if dirty."""
    key = str(cache_path)
    with _GUARD:
        if not force and _DIRTY_COUNTS.get(key, 0) == 0:
            return
        _DIRTY_COUNTS[key] = 0
        snapshot = {
            path_key: [entry[0], entry[1], entry[2]]
            for path_key, entry in source.items()
            if not prefix or path_key.startswith(prefix)
        }
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        safe_write_json(
            cache_path,
            {"version": CACHE_VERSION, "entries": snapshot},
            ensure_ascii=False,
        )
    except Exception:  # noqa: BLE001
        return


def reset_state() -> None:
    """Clear in-memory load/dirty tracking (intended for unit tests)."""
    with _GUARD:
        _LOADED_PATHS.clear()
        _DIRTY_COUNTS.clear()
