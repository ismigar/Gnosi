#!/usr/bin/env python3
"""Wait for HTTP 200 from both native loopback services within six minutes."""

from __future__ import annotations

import argparse
from collections.abc import Callable, Sequence
from http.client import HTTPConnection, HTTPException
from ipaddress import ip_address
import socket
import time
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

if TYPE_CHECKING:
    from _typeshed import WriteableBuffer

BACKEND_URL = "http://127.0.0.1:5002/api/health"
FRONTEND_URL = "http://127.0.0.1:5173/"


class _DeadlineSocket(socket.socket):
    deadline: float

    def cap_timeout(self) -> None:
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("HTTP request deadline reached")
        self.settimeout(remaining)

    def recv_into(self, buffer: WriteableBuffer, nbytes: int = 0, flags: int = 0) -> int:
        # Re-cap every header read: trickled bytes must not renew the request budget.
        self.cap_timeout()
        return super().recv_into(buffer, nbytes, flags)


def _endpoint(url: str) -> tuple[str, int, str, int]:
    """Validate before any connection; numeric loopback addresses need no DNS lookup."""
    target = urlsplit(url)
    address = ip_address("127.0.0.1" if target.hostname == "localhost" else target.hostname or "")
    if target.scheme != "http" or target.username is not None or not address.is_loopback:
        raise ValueError("Expected an HTTP loopback URL without credentials")
    port = target.port if target.port is not None else 80
    path = target.path or "/"
    if target.query:
        path += "?" + target.query
    if port == 0 or any(not "!" <= character <= "~" for character in path):
        raise ValueError("Expected a nonzero port and an ASCII URL path without whitespace")
    family = socket.AF_INET6 if address.version == 6 else socket.AF_INET
    return str(address), port, path, family


def probe_http(url: str, timeout: float) -> int:
    """Read an HTTP status without redirects, proxies, credentials or a response body."""
    deadline = time.monotonic() + min(2.0, timeout)
    host, port, path, family = _endpoint(url)
    with _DeadlineSocket(family) as transport:
        transport.deadline = deadline
        transport.cap_timeout()
        transport.connect((host, port))
        connection = HTTPConnection(host, port, timeout=timeout)
        connection.sock = transport
        try:
            transport.cap_timeout()
            connection.request("GET", path, headers={"Connection": "close"})
            with connection.getresponse() as response:
                return response.status
        finally:
            connection.close()


def _report(message: str) -> None:
    print(message, flush=True)


def wait_for_services(
    backend_url: str = BACKEND_URL,
    frontend_url: str = FRONTEND_URL,
    *,
    timeout: float = 360.0,
    probe: Callable[[str, float], int] = probe_http,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    report: Callable[[str], None] = _report,
) -> bool:
    """Require both endpoints in one cycle, charging probes and sleeps to one deadline."""
    _endpoint(backend_url)
    _endpoint(frontend_url)
    started = monotonic()
    deadline = started + timeout
    next_progress = started + 30.0
    endpoints = (("backend", backend_url), ("frontend", frontend_url))
    latest = {name: "not checked" for name, _url in endpoints}

    def summary() -> str:
        return "; ".join(f"{name} ({url}): {latest[name]}" for name, url in endpoints)

    while monotonic() < deadline:
        ready = []
        for index, (name, url) in enumerate(endpoints):
            remaining = deadline - monotonic()
            if remaining <= 0:
                ready.append(False)
                continue
            # Reserve time for the other endpoint even in the final partial cycle.
            budget = min(2.0, remaining / (len(endpoints) - index))
            try:
                status = probe(url, budget)
            except (OSError, HTTPException, ValueError) as error:
                latest[name] = f"{type(error).__name__}: {error}"
                ready.append(False)
            else:
                latest[name] = f"HTTP {status}"
                ready.append(status == 200)
        now = monotonic()
        if all(ready) and now <= deadline:
            report(f"Native services ready after {now - started:.1f}s; {summary()}")
            return True
        if now >= deadline:
            break
        if now >= next_progress:
            report(f"Waiting for native services ({now - started:.0f}s); {summary()}")
            next_progress = now + 30.0
        remaining = deadline - monotonic()
        if remaining > 0:
            sleep(min(2.0, remaining))

    report(f"Native services not ready after {monotonic() - started:.1f}s; {summary()}")
    return False


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-url", default=BACKEND_URL)
    parser.add_argument("--frontend-url", default=FRONTEND_URL)
    arguments = parser.parse_args(argv)
    try:
        return 0 if wait_for_services(arguments.backend_url, arguments.frontend_url) else 1
    except ValueError as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
