"""Bounded, cross-event-loop coordination of demand and speculative file reads."""

from __future__ import annotations

import asyncio
import os
import tempfile
import threading
import time
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from .availability import AvailabilityReason, MetadataUnavailable
from .coordinated import copy_coordinated


def revision(info: os.stat_result) -> tuple[int, ...]:
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_mode)


@dataclass
class VaultFileSnapshot:
    """A read-only view. Each consumer owns a lease on the same private file."""

    path: Path
    stat_result: os.stat_result
    _directory: tempfile.TemporaryDirectory[str] | None = field(default=None, repr=False)

    @property
    def is_private(self) -> bool:
        return self._directory is not None

    def lease(self) -> VaultFileSnapshot:
        return VaultFileSnapshot(self.path, self.stat_result, self._directory)

    def close(self) -> None:
        # TemporaryDirectory removes its contents when the last reference drops.
        self._directory = None

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
        self._jobs: dict[tuple[Path, tuple[int, ...] | None], _Request] = {}
        self._failures: OrderedDict[Path, tuple[float, tuple[int, ...] | None, AvailabilityReason]] = OrderedDict()
        # A synchronous compatibility caller on an event loop cannot await a
        # download. Hand it its same, verified result on the next HTTP attempt.
        self._handoffs: OrderedDict[Path, tuple[float, VaultFileSnapshot]] = OrderedDict()
        self._expiry: threading.Timer | None = None

    def request(
        self, path: Path, info: os.stat_result | None, *,
        timeout: float = 30, background: bool = False, handoff: bool = False,
        provider: object | None = None, provider_limit: int = 2,
    ) -> Future[VaultFileSnapshot]:
        now = time.monotonic()
        version = revision(info) if info is not None else None
        with self._guard:
            cached = self._handoffs.get(path)
            if cached is not None:
                expires, snapshot = cached
                if now < expires and revision(snapshot.stat_result) == version:
                    ready: Future[VaultFileSnapshot] = Future()
                    ready.set_result(snapshot)
                    return ready
                self._handoffs.pop(path)
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
                return job.result
            speculative = sum(item.background for item in self._jobs.values())
            if len(self._jobs) >= 64 or (background and speculative >= self._workers):
                raise MetadataUnavailable("Cloud reads are pending", path=path, reason="pending")
            job = _Request(path, timeout, background, handoff, version, provider, provider_limit)
            self._jobs[path, version] = job
            self._dispatch()
            return job.result

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
            with self._guard:
                if job.handoff:
                    self._handoffs[job.path] = (time.monotonic() + 30, snapshot)
                    while len(self._handoffs) > 16:
                        self._handoffs.popitem(last=False)
                    if self._expiry is None:
                        self._schedule_expiry(30)
                self._jobs.pop((job.path, job.version))
                self._dispatch()
            job.result.set_result(snapshot)

    def _schedule_expiry(self, seconds: float) -> None:
        self._expiry = threading.Timer(seconds, self._expire)
        self._expiry.daemon = True
        self._expiry.start()

    def _expire(self) -> None:
        with self._guard:
            self._expiry = None
            now = time.monotonic()
            for key, (expires, _) in list(self._handoffs.items()):
                if expires <= now:
                    self._handoffs.pop(key)
            if self._handoffs:
                self._schedule_expiry(min(item[0] for item in self._handoffs.values()) - now)


reads = CoordinatedReads()


async def await_snapshot(future: Future[VaultFileSnapshot]) -> VaultFileSnapshot:
    wrapped = asyncio.wrap_future(future)
    # Retrieve failures even if the only async waiter disconnects before completion.
    wrapped.add_done_callback(lambda done: None if done.cancelled() else done.exception())
    return (await asyncio.shield(wrapped)).lease()
