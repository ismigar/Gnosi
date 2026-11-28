"""Bounded, cross-event-loop coordination of demand and speculative file reads."""

from __future__ import annotations

import asyncio
import os
import tempfile
import threading
import time
import weakref
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import BinaryIO

from .availability import AvailabilityReason, MetadataUnavailable
from .coordinated import MAX_CAPTURE_SOURCES, MAX_SKILL_BYTES, copy_coordinated, verify_skill_sources


def revision(info: os.stat_result) -> tuple[int, ...]:
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_mode)


class _SnapshotState:
    """Thread-safe waiter and lease accounting for one private snapshot directory."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._directory: tempfile.TemporaryDirectory[str] | None = None
        self._pending_waiters = 0
        self._active_leases = 0
        self._retained = False

    def add_waiter(self) -> None:
        with self._lock:
            self._pending_waiters += 1

    def release_waiter(self) -> None:
        with self._lock:
            if self._pending_waiters > 0:
                self._pending_waiters -= 1
            cleanup = self._take_cleanup_locked()
        if cleanup is not None:
            cleanup.cleanup()

    def claim_lease(self) -> None:
        with self._lock:
            if self._pending_waiters > 0:
                self._pending_waiters -= 1
            self._active_leases += 1

    def add_lease(self) -> None:
        with self._lock:
            self._active_leases += 1

    def release_lease(self) -> None:
        with self._lock:
            if self._active_leases > 0:
                self._active_leases -= 1
            cleanup = self._take_cleanup_locked()
        if cleanup is not None:
            cleanup.cleanup()

    def attach_directory(
        self, directory: tempfile.TemporaryDirectory[str], *, retained: bool,
    ) -> tempfile.TemporaryDirectory[str] | None:
        with self._lock:
            self._directory = directory
            self._retained = retained
            return self._take_cleanup_locked()

    def set_retained(self, retained: bool) -> None:
        with self._lock:
            self._retained = retained
            cleanup = self._take_cleanup_locked()
        if cleanup is not None:
            cleanup.cleanup()

    def _take_cleanup_locked(self) -> tempfile.TemporaryDirectory[str] | None:
        if (
            self._directory is not None
            and not self._retained
            and self._pending_waiters == 0
            and self._active_leases == 0
        ):
            directory = self._directory
            self._directory = None
            return directory
        return None


_FUTURE_STATES: weakref.WeakKeyDictionary[Future[VaultFileSnapshot], _SnapshotState] = weakref.WeakKeyDictionary()


@dataclass
class VaultFileSnapshot:
    """A read-only view. Each consumer owns a lease on the same private file."""

    path: Path
    stat_result: os.stat_result
    _directory: tempfile.TemporaryDirectory[str] | None = field(default=None, repr=False)
    _state: _SnapshotState | None = field(default=None, repr=False)
    _leased: bool = field(default=False, repr=False)

    @property
    def is_private(self) -> bool:
        return self._directory is not None

    def lease(self) -> VaultFileSnapshot:
        if self._state is not None:
            self._state.add_lease()
        return VaultFileSnapshot(
            self.path, self.stat_result, self._directory, self._state, _leased=self._state is not None,
        )

    def claim_lease(self) -> VaultFileSnapshot:
        if self._state is not None:
            self._state.claim_lease()
        return VaultFileSnapshot(
            self.path, self.stat_result, self._directory, self._state, _leased=self._state is not None,
        )

    def close(self) -> None:
        # Clean up deterministically once the last lease and waiter finish,
        # while TemporaryDirectory remains a fallback if callers never lease.
        state = self._state
        leased = self._leased
        self._leased = False
        self._directory = None
        if leased and state is not None:
            state.release_lease()

    def __enter__(self) -> VaultFileSnapshot:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def _copy(path: Path, timeout: float) -> VaultFileSnapshot:
    directory = tempfile.TemporaryDirectory(prefix="gnosi-vault-read-")
    try:
        target = Path(directory.name) / path.name
        with target.open("xb") as handle:
            source = asyncio.run(copy_coordinated(path, handle, timeout))
        return VaultFileSnapshot(target, source, directory)
    except BaseException:
        directory.cleanup()
        raise


@dataclass
class _Request:
    path: Path
    timeout: float
    background: bool
    handoff: bool
    version: tuple[int, ...] | None
    provider: object | None
    provider_limit: int
    running: bool = False
    result: Future[VaultFileSnapshot] = field(default_factory=Future)
    state: _SnapshotState = field(default_factory=_SnapshotState)


class CoordinatedReads:
    """One shared queue across API loops, startup workers and active tasks.

    Foreground work can use every worker. Speculative reads occupy at most one
    and yield queued work to an explicit request. Cancellation of one subscriber
    never cancels another subscriber's wait.
    """

    def __init__(self, workers: int = 2) -> None:
        self._workers = workers
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="gnosi-file-access")
        self._guard = threading.Lock()
        self._verification_slot = threading.BoundedSemaphore(1)
        self._jobs: dict[tuple[Path, tuple[int, ...] | None], _Request] = {}
        self._failures: OrderedDict[Path, tuple[float, tuple[int, ...] | None, AvailabilityReason]] = OrderedDict()
        # A synchronous compatibility caller on an event loop cannot await a
        # download. Hand it its same, verified result on the next HTTP attempt.
        self._handoffs: OrderedDict[Path, tuple[float, VaultFileSnapshot]] = OrderedDict()
        self._expiry: threading.Timer | None = None

    def can_verify_source(self, path: Path, info: os.stat_result) -> bool:
        version = revision(info)
        with self._guard:
            failure = self._failures.get(path)
            return ((path, version) not in self._jobs and not (
                failure and failure[0] > time.monotonic() and failure[1] == version))

    def verify_skill_sources(
        self, expected: dict[Path, tuple[int, ...]], target: BinaryIO | None = None,
    ) -> dict[Path, os.stat_result]:
        # This optimization uses the same worker pool as foreground reads. Skip it
        # under contention and let the normal per-file requests observe their grants.
        if not self._verification_slot.acquire(blocking=False):
            return {}
        try:
            with self._guard:
                if self._jobs:
                    return {}
                pending = self._pool.submit(lambda: asyncio.run(verify_skill_sources(expected, target)))
            return pending.result()
        finally:
            self._verification_slot.release()

    def read_skill_sources(self, expected: dict[Path, tuple[int, ...]]) -> dict[Path, bytes]:
        """Return complete, revision-bound bytes from one small grant. Never retain them in the queue."""
        size = sum(stamp[2] for stamp in expected.values())
        if not 1 <= len(expected) <= MAX_CAPTURE_SOURCES or not 0 <= size <= MAX_SKILL_BYTES:
            return {}
        try:
            with tempfile.TemporaryFile() as target:
                proofs = self.verify_skill_sources(expected, target)
                if proofs.keys() != expected.keys() or os.fstat(target.fileno()).st_size != size:
                    return {}
                if any((*revision(info), getattr(info, "st_flags", 0)) != expected[path]
                       for path, info in proofs.items()):
                    return {}
                target.seek(0)
                return {path: target.read(stamp[2]) for path, stamp in expected.items()}
        except OSError:
            return {}

    def request(
        self, path: Path, info: os.stat_result | None, *,
        timeout: float = 30, background: bool = False, handoff: bool = False,
        provider: object | None = None, provider_limit: int = 2,
    ) -> Future[VaultFileSnapshot]:
        now = time.monotonic()
        version = revision(info) if info is not None else None
        evicted: list[_SnapshotState] = []
        try:
            with self._guard:
                cached = self._handoffs.get(path)
                if cached is not None:
                    expires, snapshot = cached
                    if now < expires and revision(snapshot.stat_result) == version:
                        if snapshot._state is not None:
                            snapshot._state.add_waiter()
                        ready: Future[VaultFileSnapshot] = Future()
                        if snapshot._state is not None:
                            _FUTURE_STATES[ready] = snapshot._state
                        ready.set_result(snapshot)
                        return ready
                    self._handoffs.pop(path)
                    if snapshot._state is not None:
                        evicted.append(snapshot._state)
                failure = self._failures.get(path)
                if failure is not None:
                    expires, failed_version, reason = failure
                    if now < expires and version == failed_version:
                        raise MetadataUnavailable(f"Cloud file is {reason}", path=path, reason=reason)
                    self._failures.pop(path)
                job = self._jobs.get((path, version))
                if job is not None:
                    if job.background and not background:
                        job.background = False
                        self._dispatch()
                    job.handoff = job.handoff or handoff
                    job.state.add_waiter()
                    return job.result
                speculative = sum(item.background for item in self._jobs.values())
                if len(self._jobs) >= 64 or (background and speculative >= self._workers):
                    raise MetadataUnavailable("Cloud reads are pending", path=path, reason="pending")
                job = _Request(path, timeout, background, handoff, version, provider, provider_limit)
                job.state.add_waiter()
                _FUTURE_STATES[job.result] = job.state
                self._jobs[path, version] = job
                self._dispatch()
                return job.result
        finally:
            for state in evicted:
                state.set_retained(False)

    def _dispatch(self) -> None:
        active = [job for job in self._jobs.values() if job.running]
        capacity = self._workers - len(active)
        if not capacity:
            return
        waiting = [job for job in self._jobs.values() if not job.running]
        background_active = any(job.background for job in active)
        for job in sorted(waiting, key=lambda item: item.background):
            if job.background and background_active:
                break
            if job.provider is not None and sum(item.provider is job.provider for item in active) >= job.provider_limit:
                continue
            job.running = True
            active.append(job)
            self._pool.submit(self._run, job)
            capacity -= 1
            background_active |= job.background
            if not capacity:
                break

    def _run(self, job: _Request) -> None:
        try:
            try:
                snapshot = _copy(job.path, job.timeout)
            except OSError as exc:
                raise MetadataUnavailable.from_oserror(job.path, exc) from exc
        except BaseException as error:
            with self._guard:
                if isinstance(error, MetadataUnavailable):
                    expires = time.monotonic() + (1 if error.reason == "pending" else 30)
                    self._failures[job.path] = (expires, job.version, error.reason)
                    while len(self._failures) > 256:
                        self._failures.popitem(last=False)
                self._jobs.pop((job.path, job.version))
                self._dispatch()
            job.result.set_exception(error)
        else:
            evicted: list[_SnapshotState] = []
            cleanup: tempfile.TemporaryDirectory[str] | None = None
            with self._guard:
                retained = job.handoff
                snapshot._state = job.state
                if snapshot._directory is not None:
                    cleanup = job.state.attach_directory(snapshot._directory, retained=retained)
                if retained:
                    previous = self._handoffs.get(job.path)
                    if previous is not None and previous[1]._state is not None:
                        evicted.append(previous[1]._state)
                    self._handoffs[job.path] = (time.monotonic() + 30, snapshot)
                    while len(self._handoffs) > 16:
                        _, (_, dropped) = self._handoffs.popitem(last=False)
                        if dropped._state is not None:
                            evicted.append(dropped._state)
                    if self._expiry is None:
                        self._schedule_expiry(30)
                self._jobs.pop((job.path, job.version))
                self._dispatch()
            if cleanup is not None:
                cleanup.cleanup()
            for state in evicted:
                state.set_retained(False)
            job.result.set_result(snapshot)

    def _schedule_expiry(self, seconds: float) -> None:
        self._expiry = threading.Timer(seconds, self._expire)
        self._expiry.daemon = True
        self._expiry.start()

    def _expire(self) -> None:
        expired: list[_SnapshotState] = []
        with self._guard:
            self._expiry = None
            now = time.monotonic()
            for key, (expires, snapshot) in list(self._handoffs.items()):
                if expires <= now:
                    self._handoffs.pop(key)
                    if snapshot._state is not None:
                        expired.append(snapshot._state)
            if self._handoffs:
                self._schedule_expiry(min(item[0] for item in self._handoffs.values()) - now)
        for state in expired:
            state.set_retained(False)


reads = CoordinatedReads()


def release_waiter(future: Future[VaultFileSnapshot]) -> None:
    state = _FUTURE_STATES.get(future)
    if state is not None:
        state.release_waiter()


def claim_snapshot(future: Future[VaultFileSnapshot], timeout: float = 31) -> VaultFileSnapshot:
    try:
        snapshot = future.result(timeout=timeout)
    except BaseException:
        release_waiter(future)
        raise
    return snapshot.claim_lease()


async def await_snapshot(future: Future[VaultFileSnapshot]) -> VaultFileSnapshot:
    wrapped = asyncio.wrap_future(future)
    # Retrieve failures even if the only async waiter disconnects before completion.
    wrapped.add_done_callback(lambda done: None if done.cancelled() else done.exception())
    try:
        snapshot = await asyncio.shield(wrapped)
    except BaseException:
        release_waiter(future)
        raise
    return snapshot.claim_lease()
