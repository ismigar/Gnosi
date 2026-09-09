"""Recursive media scanning with in-memory and persistent TTL caches."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import threading
from _thread import LockType
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, cast, overload

from backend.domains.media.types import MediaEntries, MediaEntry, ScanCache, ScanLocks

_scan_errors: ContextVar[list[int] | None] = ContextVar("media_scan_errors", default=None)


@contextmanager
def track_scan_errors() -> Iterator[list[int]]:
    errors = [0]
    token = _scan_errors.set(errors)
    try:
        yield errors
    finally:
        _scan_errors.reset(token)


def _record_scan_error() -> None:
    errors = _scan_errors.get()
    if errors is not None:
        errors[0] += 1


class ScanService(Protocol):
    """Facade state and late-bound collaborators used by cache operations."""

    _scan_cache: ScanCache
    _scan_locks: ScanLocks
    _locks_guard: LockType

    def _get_lock(self, key: str) -> LockType: ...

    def _load_persisted(self, target_dir: Path) -> tuple[float, MediaEntries] | None: ...

    def _save_persisted(
        self,
        target_dir: Path,
        ts: float,
        entries: MediaEntries,
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
                    _record_scan_error()
                    logger.debug(f"Skip entry {entry.path}: {error}")
                    continue
    except OSError as error:
        _record_scan_error()
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


@dataclass(frozen=True, slots=True)
class PersistedMediaEntries(Sequence[MediaEntry]):
    """Validated immutable rows; create Paths only for entries actually used."""

    _rows: tuple[tuple[str, float], ...]

    def __len__(self) -> int:
        return len(self._rows)

    @overload
    def __getitem__(self, index: int) -> MediaEntry: ...

    @overload
    def __getitem__(self, index: slice) -> PersistedMediaEntries: ...

    def __getitem__(self, index: int | slice) -> MediaEntry | PersistedMediaEntries:
        if isinstance(index, slice):
            return PersistedMediaEntries(self._rows[index])
        path, mtime = self._rows[index]
        return Path(path), mtime


def _decode_entries(raw_entries: object) -> PersistedMediaEntries:
    if not isinstance(raw_entries, list):
        raise ValueError("Invalid persisted media entries")
    rows: list[tuple[str, float]] = []
    for raw_entry in raw_entries:
        if not isinstance(raw_entry, (list, tuple)) or len(raw_entry) != 2:
            raise ValueError("Invalid persisted media entry")
        path_value, mtime_value = raw_entry
        if not isinstance(path_value, str) or not path_value or "\x00" in path_value:
            raise ValueError("Invalid persisted media path")
        if not isinstance(mtime_value, (float, int, str)):
            raise ValueError("Invalid persisted media timestamp")
        mtime = float(mtime_value)
        if not math.isfinite(mtime):
            raise ValueError("Invalid persisted media timestamp")
        rows.append((path_value, mtime))
    return PersistedMediaEntries(tuple(rows))


def load_persisted(
    target_dir: Path,
    cache_path: Callable[[Path], Path],
    logger: logging.Logger,
) -> tuple[float, MediaEntries] | None:
    """Load a valid persisted scan entry, or return ``None`` on corruption."""
    cache_file = cache_path(target_dir)
    if not cache_file.exists():
        return None
    try:
        with cache_file.open("r", encoding="utf-8") as handle:
            payload = cast(dict[str, object], json.load(handle))
        timestamp = float(cast(float | int | str, payload["ts"]))
        if not math.isfinite(timestamp):
            raise ValueError("Invalid persisted media cache timestamp")
        entries = _decode_entries(payload["entries"])
        return timestamp, entries
    except Exception as error:
        logger.debug(f"Could not load persisted cache {cache_file}: {error}")
        return None


def save_persisted(
    target_dir: Path,
    timestamp: float,
    entries: MediaEntries,
    cache_path: Callable[[Path], Path],
    logger: logging.Logger,
) -> None:
    """Persist scan data in the historical JSON wire format."""
    from backend.domains.media.index_refresh import _stage_snapshot

    temporary: Path | None = None
    try:
        cache_file = cache_path(target_dir)
        temporary = _stage_snapshot(cache_file, timestamp, entries)
        os.replace(temporary, cache_file)
        temporary = None
    except OSError as error:
        logger.debug(f"Could not persist cache for {target_dir}: {error}")
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass


def scan_with_cache(
    service: ScanService,
    target_dir: Path,
    skip_dirs: set[str] | None,
    ttl_seconds: float,
    clock: Callable[[], float],
    logger: logging.Logger,
) -> MediaEntries:
    """Return a newest-first scan using the historical two-tier cache."""
    from backend.domains.media.index_refresh import (
        capture_generation,
        current_receipt,
        publish_legacy_snapshot,
        read_index,
    )

    receipt = current_receipt()
    if receipt is not None:
        return read_index(service, target_dir, skip_dirs, ttl_seconds, clock, logger, receipt)
    cache_suffix = "::" + ",".join(sorted(skip_dirs)) if skip_dirs else ""
    key = str(target_dir) + cache_suffix
    state, generation = capture_generation(target_dir, service._persist_path(Path(key)))
    now = clock()
    cached = service._scan_cache.get(key)
    if cached and (now - cached[0]) < ttl_seconds:
        return cached[1]

    if cached is None:
        persisted = service._load_persisted(Path(key))
        if persisted and (now - persisted[0]) < ttl_seconds:
            persisted_snapshot = persisted

            def publish_persisted() -> None:
                service._scan_cache[key] = persisted_snapshot

            publish_legacy_snapshot(state, generation, persisted, publish_persisted)
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
        with track_scan_errors() as errors:
            entries = list(service._scan_recursive(target_dir, skip_dirs))
        entries.sort(key=lambda entry: entry[1], reverse=True)
        timestamp = clock()
        if not errors[0]:
            def publish() -> None:
                service._scan_cache[key] = (timestamp, entries)
                service._save_persisted(Path(key), timestamp, entries)

            publish_legacy_snapshot(state, generation, (timestamp, entries), publish)
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
    from backend.domains.media.index_refresh import invalidate_refreshes

    def invalidate() -> None:
        if target_dir is None:
            service._scan_cache.clear()
            try:
                for cache_file in persist_dir.glob("scan_*.json"):
                    cache_file.unlink(missing_ok=True)
            except OSError:
                pass
            return
        target_key = str(target_dir)
        for key in list(service._scan_cache):
            if key == target_key or key.startswith(target_key + "::"):
                service._scan_cache.pop(key, None)
        try:
            service._persist_path(target_dir).unlink(missing_ok=True)
        except OSError:
            pass

    invalidate_refreshes(target_dir, persist_dir, invalidate)
