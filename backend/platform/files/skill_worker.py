"""Reuse two native processes across event loops. Every request gets a new provider grant."""

from __future__ import annotations

import array
import asyncio
import json
import os
import socket
import struct
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path


class LegacyHelper(Exception):
    """The bundled helper rejected --worker before receiving any path or descriptor."""


def _remaining(deadline: float) -> float:
    seconds = deadline - time.monotonic()
    if seconds <= 0:
        raise TimeoutError
    return seconds


def _receive(channel: socket.socket, deadline: float, limit: int, *, line: bool = False) -> bytes:
    data = bytearray()
    while len(data) < limit:
        channel.settimeout(_remaining(deadline))
        chunk = channel.recv(limit - len(data))
        if not chunk:
            break
        data.extend(chunk)
        if line and b"\n" in chunk:
            break
    return bytes(data)


class _Worker:
    def __init__(self, helper: Path) -> None:
        self.helper = helper
        self.ready = False
        self.channel, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            self.process = subprocess.Popen(
                [str(helper), "--worker"], stdin=child.fileno(), stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, close_fds=True,
            )
        except BaseException:
            self.channel.close()
            raise
        finally:
            child.close()

    def close(self) -> None:
        try:
            self.process.kill()
            self.process.wait()
        finally:
            self.channel.close()

    def request(self, path: Path, target: int, deadline: float) -> tuple[int, object]:
        if not self.ready:
            greeting = _receive(self.channel, deadline, 4)
            if not greeting:
                try:
                    status = self.process.wait(timeout=_remaining(deadline))
                except subprocess.TimeoutExpired as exc:
                    raise TimeoutError from exc
                if status == 64:
                    raise LegacyHelper
                if status:
                    return status, None
            if greeting != b"GNS1":
                raise ValueError("Invalid file helper greeting")
            self.ready = True
        name = os.fsencode(path)
        if len(name) > 65535:
            raise ValueError("File path exceeds helper frame")
        frame = struct.pack("!H", len(name)) + name
        self.channel.settimeout(_remaining(deadline))
        rights = [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [target]))]
        if self.channel.sendmsg([b"R"], rights) != 1:
            raise OSError("Incomplete file helper request")
        self.channel.settimeout(_remaining(deadline))
        self.channel.sendall(frame)
        reply = _receive(self.channel, deadline, 2048, line=True)
        if not reply.endswith(b"\n") or reply.count(b"\n") != 1:
            raise ValueError("Incomplete file helper response")
        record = json.loads(reply)
        if not isinstance(record, list) or len(record) != 2 or type(record[0]) is not int:
            raise ValueError("Invalid file helper response")
        status, fields = record
        if status and fields is not None:
            raise ValueError("Invalid file helper failure")
        return status, fields


@dataclass
class _Request:
    cancelled: bool = False
    worker: _Worker | None = None


class SkillWorkers:
    """Each pool thread owns one socket. Callers may use short-lived asyncio loops."""

    def __init__(self) -> None:
        self._pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="gnosi-skill-snapshot")
        self._local = threading.local()
        self._guard = threading.RLock()
        self._children: set[_Worker] = set()
        self._closed = False

    def _discard(self, worker: _Worker) -> None:
        with self._guard:
            if worker not in self._children:
                return
            self._children.remove(worker)
        worker.close()

    def _worker(self, helper: Path) -> _Worker:
        worker = getattr(self._local, "worker", None)  # type: _Worker | None
        if worker is not None:
            if worker.helper == helper and worker.process.poll() is None:
                return worker
            self._discard(worker)
        worker = self._local.worker = _Worker(helper)
        with self._guard:
            self._children.add(worker)
        return worker

    def _read(
        self, request: _Request, helper: Path, path: Path, target: int, deadline: float,
    ) -> tuple[int, object]:
        _remaining(deadline)
        with self._guard:
            if self._closed or request.cancelled:
                raise OSError("File helper stopped")
        worker = self._worker(helper)
        try:
            with self._guard:
                # Popen may have raced desktop shutdown or cancellation.
                if self._closed or request.cancelled:
                    raise OSError("File helper stopped")
                request.worker = worker
            return worker.request(path, target, deadline)
        except BaseException:
            self._discard(worker)
            raise
        finally:
            with self._guard:
                request.worker = None
                cancelled = request.cancelled
            if cancelled:
                self._discard(worker)

    async def read(self, helper: Path, path: Path, target: int, timeout: float) -> tuple[int, object]:
        deadline = time.monotonic() + timeout
        request = _Request()
        with self._guard:
            if self._closed:
                raise OSError("File helper stopped")
            job = self._pool.submit(self._read, request, helper, path, target, deadline)
        done = asyncio.wrap_future(job)
        done.add_done_callback(lambda result: None if result.cancelled() else result.exception())
        try:
            return await asyncio.shield(done)
        except asyncio.CancelledError:
            if not job.cancel():
                with self._guard:
                    request.cancelled = True
                    worker = request.worker
                    if worker is not None:
                        worker.process.kill()
                if worker is not None:
                    # A request that has sent its destination must reap its child.
                    # A spawn still in progress will see cancellation before sending it.
                    with suppress(Exception):
                        await asyncio.shield(done)
            raise

    def stop_children(self) -> None:
        with self._guard:
            self._closed = True
            children = tuple(self._children)
        for worker in children:
            self._discard(worker)

    def close(self) -> None:
        self.stop_children()
        self._pool.shutdown(wait=False)
