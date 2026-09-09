"""Serve the last complete media index while a bounded refresh runs."""

from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
import threading
from _thread import RLock
from collections.abc import Callable, Iterator
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import ExitStack
from contextvars import ContextVar
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, ParamSpec, TypeVar

from backend.domains.media.types import MediaEntries, MediaEntry

if TYPE_CHECKING:
    import logging

    from backend.domains.media.scan_cache import ScanService


_REFRESH_WORKERS = 2
_MAX_PENDING_REFRESHES = 8  # Includes the two running jobs.
_RETRY_SECONDS = 30
_executor = ThreadPoolExecutor(max_workers=_REFRESH_WORKERS, thread_name_prefix="media-index")
_capacity = threading.BoundedSemaphore(_MAX_PENDING_REFRESHES)
_states_lock = threading.RLock()
_ReaderArgs = ParamSpec("_ReaderArgs")
_ReaderResult = TypeVar("_ReaderResult")


@dataclass
class IndexReceipt:
    state: str = "fresh"
    revision: str | None = None
    retry_after: int | None = None


_receipt: ContextVar[IndexReceipt | None] = ContextVar("media_index_receipt", default=None)


@dataclass
class _IndexState:
    target: Path
    cache_file: Path
    lock: RLock = field(default_factory=threading.RLock)
    generation: int = 0
    initialized: bool = False
    snapshot: tuple[float, MediaEntries] | None = None
    pending: Future[None] | None = None
    retry_at: float = 0.0


_states: dict[str, _IndexState] = {}


class MediaIndexUnavailable(Exception):
    """No complete snapshot is available after a failed or saturated scan."""


def read_with_index_state(
    reader: Callable[_ReaderArgs, _ReaderResult],
    *args: _ReaderArgs.args,
    **kwargs: _ReaderArgs.kwargs,
) -> tuple[_ReaderResult, IndexReceipt]:
    receipt = IndexReceipt()
    token = _receipt.set(receipt)
    try:
        return reader(*args, **kwargs), receipt
    finally:
        _receipt.reset(token)


def current_receipt() -> IndexReceipt | None:
    return _receipt.get()


def _record(receipt: IndexReceipt, state: str, key: str, timestamp: float, retry: int | None = None) -> None:
    receipt.state = state
    receipt.revision = hashlib.sha256(f"{key}\0{timestamp!r}".encode()).hexdigest()[:24]
    receipt.retry_after = retry


def _stage_snapshot(cache_file: Path, timestamp: float, entries: MediaEntries) -> Path:
    """Encode completely before the short generation-checked atomic replace."""
    encoded = json.dumps({"ts": timestamp, "entries": [[str(path), mtime] for path, mtime in entries]})
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{cache_file.name}.", suffix=".tmp", dir=cache_file.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        return temporary
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def _refresh(
    state: _IndexState,
    generation: int,
    scan: Callable[[Path, set[str] | None], Iterator[MediaEntry]],
    target: Path,
    exclusions: set[str] | None,
    cache: dict[str, tuple[float, MediaEntries]],
    key: str,
    clock: Callable[[], float],
    logger: logging.Logger,
) -> None:
    # All filesystem inputs are captured by the caller. Executor workers do not
    # inherit request ContextVars or resolve an active vault/root.
    from backend.domains.media.scan_cache import track_scan_errors

    temporary: Path | None = None
    try:
        with state.lock:
            if state.generation != generation:
                return
        with track_scan_errors() as errors:
            entries = list(scan(target, exclusions))
        if errors[0]:
            raise OSError("Media scan included unreadable entries or directories")
        entries.sort(key=lambda entry: entry[1], reverse=True)
        timestamp = clock()
        try:
            temporary = _stage_snapshot(state.cache_file, timestamp, entries)
        except OSError as error:
            logger.warning("[media] complete index could not be persisted (%s)", type(error).__name__)
        with state.lock:
            if state.generation != generation:
                return
            if temporary is not None:
                try:
                    os.replace(temporary, state.cache_file)
                    temporary = None
                except OSError as error:
                    logger.warning("[media] complete index could not be persisted (%s)", type(error).__name__)
            state.snapshot = (timestamp, entries)
            cache[key] = state.snapshot
            state.retry_at = 0.0
        logger.info("[media] background index refreshed (%d files)", len(entries))
    except Exception as error:
        with state.lock:
            if state.generation == generation:
                state.retry_at = clock() + _RETRY_SECONDS
        logger.warning("[media] index refresh failed (%s); last complete index retained", type(error).__name__)
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
        with state.lock:
            if state.generation == generation:
                state.pending = None
        _capacity.release()


def capture_generation(target: Path, cache_file: Path) -> tuple[_IndexState, int]:
    """Give legacy blocking scans the same invalidation publication guard."""
    with _states_lock:
        state = _states.setdefault(str(cache_file), _IndexState(target, cache_file))
    with state.lock:
        return state, state.generation


def publish_legacy_snapshot(
    state: _IndexState,
    generation: int,
    snapshot: tuple[float, MediaEntries],
    publish: Callable[[], None],
) -> None:
    with state.lock:
        if state.generation != generation:
            return
        publish()
        state.snapshot = snapshot
        state.initialized = True
        state.retry_at = 0.0


def read_index(
    service: ScanService,
    target: Path,
    exclusions: set[str] | None,
    ttl: float,
    clock: Callable[[], float],
    logger: logging.Logger,
    receipt: IndexReceipt,
) -> MediaEntries:
    suffix = "::" + ",".join(sorted(exclusions)) if exclusions else ""
    key = str(target) + suffix
    cache_file = service._persist_path(Path(key))
    state_key = str(cache_file)
    with _states_lock:
        state = _states.setdefault(state_key, _IndexState(target, cache_file))
    while True:
        with state.lock:
            if not state.initialized:
                state.snapshot = service._scan_cache.get(key) or service._load_persisted(Path(key))
                state.initialized = True
            now = clock()
            snapshot = state.snapshot
            if snapshot is not None and now - snapshot[0] < ttl:
                _record(receipt, "fresh", state_key, snapshot[0])
                return snapshot[1]
            if state.pending is None and now >= state.retry_at:
                if _capacity.acquire(blocking=False):
                    try:
                        state.pending = _executor.submit(
                            _refresh, state, state.generation, service._scan_recursive,
                            target, set(exclusions) if exclusions is not None else None,
                            service._scan_cache, key, clock, logger,
                        )
                    except Exception as error:
                        _capacity.release()
                        state.retry_at = now + _RETRY_SECONDS
                        logger.warning("[media] index refresh could not start (%s)", type(error).__name__)
                else:
                    # The queue is bounded as well as the active worker count.
                    state.retry_at = now + _RETRY_SECONDS
            pending = state.pending
            if snapshot is not None:
                _record(receipt, "refreshing" if pending is not None else "failed", state_key, snapshot[0],
                        None if pending is not None else max(1, math.ceil(state.retry_at - now)))
                return snapshot[1]
            if pending is None:
                raise MediaIndexUnavailable("No complete media index is available")
        # A first index has no valid snapshot to display. Share that scan and
        # keep the historical blocking behavior until it completes.
        pending.result()


def invalidate_refreshes(target: Path | None, persist_dir: Path, invalidate: Callable[[], None]) -> None:
    """Retire work and delete caches under the same short publication locks."""
    with _states_lock, ExitStack() as stack:
        states = [state for state in _states.values()
                  if state.cache_file.parent == persist_dir and (target is None or state.target == target)]
        for state in states:
            stack.enter_context(state.lock)
        for state in states:
            state.generation += 1
            state.snapshot = None
            state.pending = None
            state.initialized = True  # Never resurrect a deleted persisted snapshot.
            state.retry_at = 0.0
            try:
                state.cache_file.unlink(missing_ok=True)
            except OSError:
                pass
        invalidate()
