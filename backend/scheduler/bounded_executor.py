"""Bounded daemon worker pool dedicated to scheduled application work."""

from __future__ import annotations

import queue
import threading
from collections.abc import Callable
from dataclasses import dataclass

TaskCallback = Callable[[], object]


@dataclass(frozen=True)
class _WorkItem:
    name: str
    callback: TaskCallback


@dataclass(frozen=True)
class _StopWorker:
    pass


_STOP = _StopWorker()


class BoundedTaskExecutor:
    """Execute named callbacks with bounded concurrency and no duplicate backlog."""

    def __init__(self, *, max_workers: int, max_queue_size: int) -> None:
        if max_workers < 1 or max_queue_size < 1:
            raise ValueError("Scheduler executor bounds must be positive")
        self._queue: queue.Queue[_WorkItem | _StopWorker] = queue.Queue(maxsize=max_queue_size)
        self._names: set[str] = set()
        self._lock = threading.Lock()
        self._accepting = True
        self._threads = [
            threading.Thread(
                target=self._worker,
                name=f"gnosi-scheduler-worker-{index + 1}",
                daemon=True,
            )
            for index in range(max_workers)
        ]
        for thread in self._threads:
            thread.start()

    def submit(self, name: str, callback: TaskCallback) -> bool:
        """Queue a task unless that name is active, queued, or capacity is full."""
        with self._lock:
            if not self._accepting or name in self._names:
                return False
            self._names.add(name)
            try:
                self._queue.put_nowait(_WorkItem(name, callback))
            except queue.Full:
                self._names.remove(name)
                return False
        return True

    def shutdown(self, *, timeout: float) -> bool:
        """Reject work, cancel queued callbacks and join workers within ``timeout``."""
        with self._lock:
            self._accepting = False
        while True:
            try:
                item = self._queue.get_nowait()
            except queue.Empty:
                break
            if isinstance(item, _WorkItem):
                with self._lock:
                    self._names.discard(item.name)
            self._queue.task_done()
        for _thread in self._threads:
            self._queue.put_nowait(_STOP)
        per_worker_timeout = max(0.0, timeout) / len(self._threads)
        for thread in self._threads:
            thread.join(per_worker_timeout)
        return all(not thread.is_alive() for thread in self._threads)

    def is_pending(self, name: str) -> bool:
        """Return whether ``name`` is queued or running."""
        with self._lock:
            return name in self._names

    def _worker(self) -> None:
        while True:
            item = self._queue.get()
            try:
                if isinstance(item, _StopWorker):
                    return
                try:
                    item.callback()
                finally:
                    with self._lock:
                        self._names.discard(item.name)
            finally:
                self._queue.task_done()


class SchedulerExecutionRuntime:
    """Own the scheduler worker pool and its submission policy."""

    def __init__(self) -> None:
        self._executor: BoundedTaskExecutor | None = None
        self._lock = threading.Lock()

    def start(self, *, max_workers: int, max_queue_size: int) -> None:
        """Create workers once; manual and clock submissions share this pool."""
        with self._lock:
            if self._executor is None:
                self._executor = BoundedTaskExecutor(
                    max_workers=max_workers,
                    max_queue_size=max_queue_size,
                )

    def submit(
        self,
        name: str,
        callback: TaskCallback,
        *,
        max_workers: int,
        max_queue_size: int,
    ) -> bool:
        """Lazily start the pool and submit one named callback."""
        self.start(max_workers=max_workers, max_queue_size=max_queue_size)
        with self._lock:
            executor = self._executor
        if executor is None:  # Defensive: start always installs it.
            return False
        return executor.submit(name, callback)

    def shutdown(self, *, timeout: float) -> bool:
        """Detach and stop the current pool so a later start is fresh."""
        with self._lock:
            executor = self._executor
            self._executor = None
        return executor.shutdown(timeout=timeout) if executor else True
