"""Nonblocking PTY writes with one caller-owned absolute deadline."""
from __future__ import annotations

import errno
import os
import select
from collections.abc import Callable


def write_pty(fd: int, payload: bytes, remaining: Callable[[], float]) -> int:
    blocking = os.get_blocking(fd)
    os.set_blocking(fd, False)
    offset = 0
    try:
        while offset < len(payload):
            remaining()
            try:
                written = os.write(fd, payload[offset:])
            except BlockingIOError:
                select.select([], [fd], [], remaining())
                continue
            except OSError as error:
                if error.errno in {errno.EIO, errno.EPIPE, errno.ECONNRESET}:
                    raise ConnectionAbortedError("The SSH terminal disconnected") from None
                raise
            if not written:
                raise ConnectionAbortedError("The SSH terminal closed during a write")
            offset += written
        remaining()
        return offset
    finally:
        os.set_blocking(fd, blocking)
