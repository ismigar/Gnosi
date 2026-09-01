"""Recursive media scanning with in-memory and persistent TTL caches."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from _thread import LockType
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Protocol, cast

from backend.domains.media.types import MediaEntry, ScanCache, ScanLocks


class ScanService(Protocol):
    """Facade state and late-bound collaborators used by cache operations."""

    _scan_cache: ScanCache
    _scan_locks: ScanLocks
    _locks_guard: LockType

    def _get_lock(self, key: str) -> LockType: ...

    def _load_persisted(self, target_dir: Path) -> tuple[float, list[MediaEntry]] | None: ...

    def _save_persisted(
        self,
        target_dir: Path,
        ts: float,
        entries: list[MediaEntry],
    ) -> None: ...

    def _scan_recursive(
        self,
        root: Path,
        skip_dirs: set[str] | None = None,
    ) -> Iterator[MediaEntry]: ...

    def _persist_path(self, target_dir: Path) -> Path: ...


def scan_recursive(
    root: Path,
    skip_dirs: set[str] | None,
    *,
    valid_extensions: set[str],
    recurse: Callable[[Path, set[str] | None], Iterator[MediaEntry]],
    logger: logging.Logger,
) -> Iterator[MediaEntry]:
    """Yield valid files recursively while avoiding extra provider stats."""
    try:
        with os.scandir(root) as entries:
            for entry in entries:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        if skip_dirs and entry.name in skip_dirs:
                            continue
                        if entry.name.startswith(".") and skip_dirs is not None:
                            continue
                        yield from recurse(Path(entry.path), skip_dirs)
                    elif entry.is_file(follow_symlinks=False):
                        extension = os.path.splitext(entry.name)[1].lower()
                        if extension in valid_extensions:
                            yield Path(entry.path), entry.stat().st_mtime
                except OSError as error:
                    logger.debug(f"Skip entry {entry.path}: {error}")
                    continue
    except OSError as error:
        logger.debug(f"Skip dir {root}: {error}")


def get_lock(
    key: str,
    scan_locks: ScanLocks,
    locks_guard: LockType,
) -> LockType:
    """Return one stable lock per scan-cache key."""
    with locks_guard:
        lock = scan_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            scan_locks[key] = lock
        return lock


def persist_path(target_dir: Path, persist_dir: Path) -> Path:
    """Return the deterministic JSON-cache path for a scan target."""
    digest = hashlib.sha1(str(target_dir).encode("utf-8")).hexdigest()[:16]
    return persist_dir / f"scan_{digest}.json"


def _decode_entries(raw_entries: object) -> list[MediaEntry]:
    decoded: list[MediaEntry] = []
    for raw_entry in cast(list[object], raw_entries):
        path_value, mtime_value = cast(tuple[object, object], raw_entry)
        decoded.append((Path(cast(str, path_value)), float(cast(float | int | str, mtime_value))))
    return decoded


def load_persisted(
    target_dir: Path,
    cache_path: Callable[[Path], Path],
    logger: logging.Logger,
) -> tuple[float, list[MediaEntry]] | None:
    """Load a valid persisted scan entry, or return ``None`` on corruption."""
    cache_file = cache_path(target_dir)
    if not cache_file.exists():
        return None
    try:
        with cache_file.open("r", encoding="utf-8") as handle:
            payload = cast(dict[str, object], json.load(handle))
        timestamp = float(cast(float | int | str, payload["ts"]))
        entries = _decode_entries(payload["entries"])
        return timestamp, entries
    except Exception as error:
        logger.debug(f"Could not load persisted cache {cache_file}: {error}")
        return None


def save_persisted(
    target_dir: Path,
    timestamp: float,
    entries: list[MediaEntry],
    cache_path: Callable[[Path], Path],
    logger: logging.Logger,
) -> None:
    """Persist scan data in the historical JSON wire format."""
    try:
        cache_file = cache_path(target_dir)
        payload = {
            "ts": timestamp,
            "entries": [[str(path), mtime] for path, mtime in entries],
        }
        with cache_file.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle)
    except OSError as error:
        logger.debug(f"Could not persist cache for {target_dir}: {error}")


def scan_with_cache(
    service: ScanService,
    target_dir: Path,
    skip_dirs: set[str] | None,
    ttl_seconds: float,
    clock: Callable[[], float],
    logger: logging.Logger,
) -> list[MediaEntry]:
    """Return a newest-first scan using the historical two-tier cache."""
    cache_suffix = "::" + ",".join(sorted(skip_dirs)) if skip_dirs else ""
    key = str(target_dir) + cache_suffix
    now = clock()
    cached = service._scan_cache.get(key)
    if cached and (now - cached[0]) < ttl_seconds:
        return cached[1]

    if cached is None:
        persisted = service._load_persisted(Path(key))
        if persisted and (now - persisted[0]) < ttl_seconds:
            service._scan_cache[key] = persisted
            logger.info(
                f"[media] reused persisted cache for {target_dir} ({len(persisted[1])} files)"
            )
            return persisted[1]

    lock = service._get_lock(key)
    with lock:
        cached = service._scan_cache.get(key)
        if cached and (clock() - cached[0]) < ttl_seconds:
            return cached[1]
        started = clock()
        entries = list(service._scan_recursive(target_dir, skip_dirs))
        entries.sort(key=lambda entry: entry[1], reverse=True)
        timestamp = clock()
        service._scan_cache[key] = (timestamp, entries)
        service._save_persisted(Path(key), timestamp, entries)
        logger.info(
            f"[media] scan {target_dir}: {len(entries)} files in {timestamp - started:.1f}s"
        )
        return entries


def invalidate_cache(
    service: ScanService,
    target_dir: Path | None,
    persist_dir: Path,
) -> None:
    """Invalidate one historical cache key or every persisted scan."""
    if target_dir is None:
        service._scan_cache.clear()
        try:
            for cache_file in persist_dir.glob("scan_*.json"):
                cache_file.unlink(missing_ok=True)
        except OSError:
            pass
        return
    service._scan_cache.pop(str(target_dir), None)
    try:
        service._persist_path(target_dir).unlink(missing_ok=True)
    except OSError:
        pass
