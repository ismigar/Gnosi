"""A stalled terminal must not hold private reads beyond their absolute deadline."""
from __future__ import annotations

import os
import threading
import time
from types import SimpleNamespace

import pytest

from backend.domains.sites.bounded_child import DeadlineChild
from backend.domains.sites.bounded_pty import write_pty


def remaining_until(deadline):
    def remaining():
        value = deadline - time.monotonic()
        if value <= 0:
            raise TimeoutError("synthetic deadline")
        return value
    return remaining


@pytest.mark.parametrize("method", ["send", "sendline"])
def test_full_terminal_write_is_interruptible_and_restores_descriptor_mode(method):
    read_fd, write_fd = os.pipe()
    finished = threading.Event()

    def drain_if_write_stalls():
        # Unblock a regressed blocking writer so the test can fail rather than hang.
        if finished.wait(0.6):
            return
        while os.read(read_fd, 65536):
            pass

    watchdog = threading.Thread(target=drain_if_write_stalls)
    try:
        os.set_blocking(write_fd, False)
        while True:
            try:
                os.write(write_fd, b"f" * 4096)
            except BlockingIOError:
                break
        os.set_blocking(write_fd, True)
        child = SimpleNamespace(child_fd=write_fd, delaybeforesend=None,
                                send=lambda value: os.write(write_fd, value.encode()),
                                sendline=lambda value: os.write(write_fd, (value + "\n").encode()))
        started = time.monotonic()
        terminal = DeadlineChild(child, remaining_until(started + 0.05))
        watchdog.start()
        with pytest.raises(TimeoutError):
            getattr(terminal, method)("x" * 64000)
        assert time.monotonic() - started < 0.45
        assert os.get_blocking(write_fd) is True
    finally:
        finished.set()
        os.close(write_fd)
        if watchdog.ident is not None:
            watchdog.join(2)
        os.close(read_fd)
    assert not watchdog.is_alive()


def test_partial_writes_preserve_exact_utf8_bytes_and_line_endings():
    read_fd, write_fd = os.pipe()
    output = bytearray()

    def reader():
        while value := os.read(read_fd, 4096):
            output.extend(value)

    thread = threading.Thread(target=reader)
    text = "àèíòú·" * 12000
    try:
        thread.start()
        terminal = DeadlineChild(SimpleNamespace(child_fd=write_fd, delaybeforesend=None), remaining_until(time.monotonic() + 2))
        assert terminal.sendline(text) == len((text + "\n").encode("utf-8"))
        assert os.get_blocking(write_fd) is True
    finally:
        os.close(write_fd)
        thread.join(2)
        os.close(read_fd)
    assert not thread.is_alive() and bytes(output) == (text + "\n").encode("utf-8")


def test_closed_terminal_is_classified_and_nonblocking_mode_is_preserved():
    read_fd, write_fd = os.pipe()
    os.close(read_fd)
    try:
        os.set_blocking(write_fd, False)
        with pytest.raises(ConnectionAbortedError):
            write_pty(write_fd, b"synthetic", remaining_until(time.monotonic() + 1))
        assert os.get_blocking(write_fd) is False
    finally:
        os.close(write_fd)
