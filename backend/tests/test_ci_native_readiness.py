"""Synthetic HTTP and deadline checks for the native CI readiness helper."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time

import pytest

from scripts.ci import wait_native_services as readiness


class Clock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        assert 0 < seconds <= 2.0
        self.sleeps.append(seconds)
        self.now += seconds


@contextmanager
def http_server(
    status: int = 200, *, stalled: bool = False, trickled: bool = False
) -> Iterator[str]:
    release = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if stalled:
                release.wait(5)
                return
            if trickled:
                try:
                    for byte in b"HTTP/1.1 200 OK\r\nX-Slow: " + b"a" * 100:
                        self.wfile.write(bytes([byte]))
                        if release.wait(0.01):
                            break
                except OSError:
                    pass
                return
            self.send_response(status if self.path in {"/", "/api/health"} else 404)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, format: str, *args: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.01))
    worker.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        release.set()
        server.shutdown()
        worker.join(timeout=5)
        server.server_close()
        assert not worker.is_alive()


@pytest.mark.parametrize("status", [200, 204, 302, 500])
def test_probe_reads_actual_http_status(status: int) -> None:
    with http_server(status) as url:
        assert readiness.probe_http(url + "/api/health", 0.5) == status


@pytest.mark.parametrize("trickled", [False, True], ids=["never-response", "trickled-headers"])
def test_probe_bounds_the_entire_request(trickled: bool) -> None:
    with http_server(stalled=not trickled, trickled=trickled) as url:
        started = time.monotonic()
        with pytest.raises(TimeoutError):
            readiness.probe_http(url, 0.08)
        assert 0.05 <= time.monotonic() - started < 0.8


def test_probe_reports_an_unavailable_port() -> None:
    with socket.socket() as bound:
        bound.bind(("127.0.0.1", 0))
        # A bound, non-listening port is refused on Linux and may time out on macOS.
        with pytest.raises((ConnectionRefusedError, TimeoutError)):
            readiness.probe_http(f"http://127.0.0.1:{bound.getsockname()[1]}/", 0.5)


def test_cli_checks_both_loopback_urls() -> None:
    script = Path(__file__).resolve().parents[2] / "scripts/ci/wait_native_services.py"
    with http_server() as backend, http_server() as frontend:
        result = subprocess.run(
            [sys.executable, "-I", "-S", "-B", str(script),
             "--backend-url", backend + "/api/health", "--frontend-url", frontend + "/"],
            capture_output=True, text=True, env={}, timeout=5, check=False,
        )
    assert result.returncode == 0, result.stderr
    assert "Native services ready" in result.stdout
    assert f"backend ({backend}/api/health): HTTP 200" in result.stdout
    assert f"frontend ({frontend}/): HTTP 200" in result.stdout


@pytest.mark.parametrize("down", [readiness.BACKEND_URL, readiness.FRONTEND_URL])
@pytest.mark.parametrize("failure", [ConnectionRefusedError("connection refused"), 500, 204, 302])
def test_wait_checks_both_endpoints_and_reports_each_result(
    down: str, failure: Exception | int
) -> None:
    clock = Clock()
    calls: list[str] = []
    messages: list[str] = []

    def probe(url: str, timeout: float) -> int:
        assert 0 < timeout <= 2
        calls.append(url)
        if url == down:
            if isinstance(failure, Exception):
                raise failure
            return failure
        return 200

    assert not readiness.wait_for_services(
        timeout=3, probe=probe, monotonic=clock.monotonic,
        sleep=clock.sleep, report=messages.append,
    )
    assert calls == [readiness.BACKEND_URL, readiness.FRONTEND_URL] * 2
    assert clock.now == 3
    assert clock.sleeps == [2, 1]
    assert "backend (" in messages[-1] and "frontend (" in messages[-1]
    assert "HTTP 200" in messages[-1]
    error = "connection refused" if isinstance(failure, Exception) else f"HTTP {failure}"
    assert error in messages[-1]


def test_total_360_second_deadline_caps_every_probe_and_sleep() -> None:
    clock = Clock()
    clock.now = 50.0
    calls: list[tuple[str, float]] = []
    messages: list[str] = []

    def probe(url: str, timeout: float) -> int:
        assert 0 < timeout <= min(2.0, 410.0 - clock.now)
        calls.append((url, timeout))
        clock.now += timeout
        raise TimeoutError(f"no response from {url}")

    assert not readiness.wait_for_services(
        probe=probe, monotonic=clock.monotonic, sleep=clock.sleep, report=messages.append,
    )
    assert clock.now == 410
    assert calls == [(readiness.BACKEND_URL, 2), (readiness.FRONTEND_URL, 2)] * 60
    assert clock.sleeps == [2] * 60
    assert len([message for message in messages if message.startswith("Waiting")]) == 11
    assert "360.0s" in messages[-1]
    assert messages[-1].count("TimeoutError: no response") == 2


def test_final_cycle_reserves_time_to_probe_both_services() -> None:
    clock = Clock()
    budgets: list[float] = []

    def probe(url: str, timeout: float) -> int:
        budgets.append(timeout)
        clock.now += timeout
        raise TimeoutError(url)

    assert not readiness.wait_for_services(
        timeout=1, probe=probe, monotonic=clock.monotonic, sleep=clock.sleep, report=lambda _: None,
    )
    assert budgets == [0.5, 0.5]
    assert clock.now == 1
    assert clock.sleeps == []


def test_progress_reporting_does_not_extend_the_deadline() -> None:
    clock = Clock()
    reports: list[float] = []

    def report(message: str) -> None:
        reports.append(clock.now)
        if message.startswith("Waiting"):
            clock.now += 0.5

    assert not readiness.wait_for_services(
        timeout=31, probe=lambda _url, _timeout: 500,
        monotonic=clock.monotonic, sleep=clock.sleep, report=report,
    )
    assert reports == [30, 31]


@pytest.mark.parametrize("recover", [True, False], ids=["transient-recovery", "never-same-cycle"])
def test_readiness_requires_both_200s_in_the_same_cycle(recover: bool) -> None:
    clock = Clock()
    messages: list[str] = []
    statuses = iter([200, 500, 500, 200, 200, 200 if recover else 500])

    def probe(url: str, timeout: float) -> int:
        return next(statuses)

    assert readiness.wait_for_services(
        timeout=5, probe=probe, monotonic=clock.monotonic,
        sleep=clock.sleep, report=messages.append,
    ) is recover
    assert clock.now == (4 if recover else 5)
    assert ("Native services ready" in messages[-1]) is recover


def test_a_probe_returning_after_the_deadline_cannot_report_readiness() -> None:
    clock = Clock()

    def late_probe(url: str, timeout: float) -> int:
        clock.now += 0.6
        return 200

    assert not readiness.wait_for_services(
        timeout=1, probe=late_probe, monotonic=clock.monotonic,
        sleep=clock.sleep, report=lambda _: None,
    )
    assert clock.now == pytest.approx(1.2)
    assert clock.sleeps == []


def test_main_returns_failure_exit_code(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(readiness, "wait_for_services", lambda _backend, _frontend: False)
    assert readiness.main([]) == 1


@pytest.mark.parametrize("flag", ["--backend-url", "--frontend-url"])
@pytest.mark.parametrize("url", [
    "http://192.0.2.1/", "http://example.invalid/", "https://127.0.0.1/", "bad-url",
    "http://u:p@127.0.0.1/", "http://127.0.0.1:bad/", "http://127.0.0.1/a b",
])
def test_cli_rejects_invalid_urls_before_any_probe(
    monkeypatch: pytest.MonkeyPatch, flag: str, url: str
) -> None:
    def unexpected_connect(*args: object) -> None:
        raise AssertionError("invalid URLs must fail before either connection")

    monkeypatch.setattr(readiness._DeadlineSocket, "connect", unexpected_connect)
    with pytest.raises(SystemExit) as error:
        readiness.main([flag, url])
    assert error.value.code == 2
