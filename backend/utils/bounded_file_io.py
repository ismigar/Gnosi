"""Deadline-bound reads of already-authorized descriptors in an owned child.

The child receives no paths or configuration. Descriptor confinement and source
identity checks belong to its caller. Killing a blocked child reaps the reader;
an asyncio timeout around a filesystem thread cannot provide that guarantee.
"""
from __future__ import annotations

import array
from contextlib import contextmanager
from contextvars import ContextVar
import hashlib
import os
from pathlib import Path
import socket
import stat
import struct
import subprocess
import sys
import threading
import time
from collections.abc import Iterator

_REQUEST = struct.Struct("!BQ")
_RESPONSE = struct.Struct("!BQ32s")
_MAXIMUM = 1024 ** 3
_CHUNK = 1024 ** 2
_current: ContextVar[Reader | None] = ContextVar("website_file_reader", default=None)


class ReadUnavailable(OSError):
    """The owned reader failed or exceeded its deadline."""


def cloud_path(path: Path) -> bool:
    return sys.platform == "darwin" and any(
        part in str(path) for part in ("/Library/CloudStorage/", "/Library/Mobile Documents/")
    )


class Reader:
    def __init__(self, timeout: float = 10.0) -> None:
        self.timeout = timeout
        self.process: subprocess.Popen[bytes] | None = None
        self.channel: socket.socket | None = None

    def _start(self) -> socket.socket:
        if self.channel is not None:
            return self.channel
        parent, child = socket.socketpair()
        arguments = [str(child.fileno()), str(os.getpid())]
        command = ([sys.executable, "--bounded-file-io-worker", *arguments]
                   if getattr(sys, "frozen", False)
                   else [sys.executable, str(Path(__file__).resolve()), *arguments])
        try:
            self.process = subprocess.Popen(command, pass_fds=(child.fileno(),),
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.channel = parent
            return parent
        except BaseException:
            parent.close()
            raise
        finally:
            child.close()

    def _receive(self, count: int, deadline: float) -> bytes:
        channel = self._start()
        output = bytearray()
        while len(output) < count:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ReadUnavailable("The cloud file read exceeded its deadline")
            channel.settimeout(remaining)
            data = channel.recv(min(_CHUNK, count - len(output)))
            if not data:
                raise ReadUnavailable("The cloud file reader exited")
            output.extend(data)
        return bytes(output)

    def run(self, source: int, maximum: int, target: int | None = None, *, read_bytes: bool = True) -> tuple[bytes, str, int]:
        if not 0 <= maximum <= _MAXIMUM:
            raise ValueError("Invalid bounded read allowance")
        channel = self._start()
        deadline = time.monotonic() + self.timeout
        descriptors = array.array("i", [source] if target is None else [source, target])
        try:
            channel.settimeout(self.timeout)
            mode = 1 if target is not None else (0 if read_bytes else 2)
            request = _REQUEST.pack(mode, maximum)
            sent = channel.sendmsg([request], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, descriptors)])
            if sent != len(request):
                raise ReadUnavailable("Incomplete cloud reader request")
            status, size, digest = _RESPONSE.unpack(self._receive(_RESPONSE.size, deadline))
            if status or size > maximum + 1:
                raise ReadUnavailable("The cloud source is unavailable")
            data = self._receive(size, deadline) if mode == 0 else b""
            return data, digest.hex(), size
        except (OSError, ValueError, struct.error) as error:
            self.close()
            raise ReadUnavailable("The cloud source is unavailable; retry after downloading it") from error

    def close(self) -> None:
        if self.channel is not None:
            self.channel.close()
            self.channel = None
        if self.process is not None:
            process, self.process = self.process, None
            try:
                process.wait(timeout=0.5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)


@contextmanager
def session() -> Iterator[Reader]:
    existing = _current.get()
    if existing is not None:
        yield existing
        return
    reader = Reader()
    token = _current.set(reader)
    try:
        yield reader
    finally:
        reader.close()
        _current.reset(token)


def transfer(source: int, maximum: int, target: int | None = None, *, read_bytes: bool = True) -> tuple[bytes, str, int]:
    with session() as reader:
        return reader.run(source, maximum, target, read_bytes=read_bytes)


def _watch_owner(owner: int) -> None:
    while os.getppid() == owner:
        time.sleep(0.2)
    os._exit(74)


def _operation(descriptors: list[int], maximum: int, mode: int) -> tuple[bytes, bytes, int]:
    if len(descriptors) != (2 if mode == 1 else 1) or maximum > _MAXIMUM:
        raise ValueError("Invalid reader request")
    source = os.fstat(descriptors[0])
    if not stat.S_ISREG(source.st_mode) or source.st_size > maximum:
        raise ValueError("Invalid source descriptor")
    if mode == 1:
        target = os.fstat(descriptors[1])
        if not stat.S_ISREG(target.st_mode) or (source.st_dev, source.st_ino) == (target.st_dev, target.st_ino):
            raise ValueError("Invalid output descriptor")
    digest, total, output = hashlib.sha256(), 0, bytearray()
    while data := os.read(descriptors[0], min(_CHUNK, maximum - total + 1)):
        total += len(data)
        if total > maximum:
            raise ValueError("Source exceeds its allowance")
        digest.update(data)
        if mode == 1:
            view = memoryview(data)
            while view:
                view = view[os.write(descriptors[1], view):]
        elif mode == 0:
            output.extend(data)
    return bytes(output), digest.digest(), total


def worker_main(descriptor: int, owner: int) -> int:
    if os.getppid() != owner:
        return 74
    threading.Thread(target=_watch_owner, args=(owner,), daemon=True).start()
    with socket.socket(fileno=descriptor) as channel:
        while True:
            header, controls, flags, _ = channel.recvmsg(_REQUEST.size, socket.CMSG_SPACE(8))
            if not header:
                return 0
            descriptors: list[int] = []
            for level, kind, value in controls:
                if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                    values = array.array("i")
                    values.frombytes(value[:len(value) - len(value) % values.itemsize])
                    descriptors.extend(values)
            try:
                while len(header) < _REQUEST.size:
                    data = channel.recv(_REQUEST.size - len(header))
                    if not data:
                        return 74
                    header += data
                mode, maximum = _REQUEST.unpack(header)
                if flags & socket.MSG_CTRUNC or mode not in (0, 1, 2):
                    raise ValueError("Invalid request framing")
                data, digest, size = _operation(descriptors, maximum, mode)
                channel.sendall(_RESPONSE.pack(0, size, digest))
                if mode == 0:
                    channel.sendall(data)
            except (OSError, ValueError, struct.error):
                channel.sendall(_RESPONSE.pack(1, 0, bytes(32)))
            finally:
                for item in descriptors:
                    os.close(item)


if __name__ == "__main__":
    raise SystemExit(worker_main(int(sys.argv[1]), int(sys.argv[2])))
