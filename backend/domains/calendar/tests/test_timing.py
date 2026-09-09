"""Synthetic timing checks with route imports isolated from the invoking process."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
import os
from pathlib import Path
import subprocess
import sys
from threading import Barrier, local
from types import ModuleType
from typing import TYPE_CHECKING, Any, Callable, TypeVar

import pytest

from backend.domains.calendar import timing

if TYPE_CHECKING:
    from backend.services.integration_manager import IntegrationManager

CalendarModules = tuple[ModuleType, ModuleType, "IntegrationManager"]
T = TypeVar("T")


def test_disabled_timing_never_reads_clock_and_preserves_worker_results(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden_clock() -> None:
        raise AssertionError("Disabled diagnostics must not sample the clock")

    monkeypatch.setattr(timing, "perf_counter", forbidden_clock)
    with timing.collect_calendar_timing(False) as captured:
        with timing.calendar_phase("http"):
            assert asyncio.run(timing.calendar_to_thread(lambda: "unchanged")) == "unchanged"
        with ThreadPoolExecutor(max_workers=2) as executor:
            assert timing.calendar_worker_map(executor, lambda item: item + 1, [1, 2]) == [2, 3]
    assert captured is None


def test_queue_duration_is_separate_from_work_and_request_total(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [0.0]
    monkeypatch.setattr(timing, "perf_counter", lambda: clock[0])

    async def queued_thread(function: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        clock[0] += 3.0
        return function(*args, **kwargs)

    monkeypatch.setattr(asyncio, "to_thread", queued_thread)

    def work(value: str) -> str:
        with timing.calendar_phase("integrations"):
            clock[0] += 2.0
            return value

    with timing.collect_calendar_timing(True) as captured:
        assert asyncio.run(timing.calendar_to_thread(work, "same-result")) == "same-result"
    assert captured is not None
    assert captured.header() == (
        "cal_total;dur=5000.000, cal_queue;dur=3000.000, cal_integrations;dur=2000.000"
    )


def test_provider_workers_share_timings_without_request_identity_and_reset_afterwards(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = local()

    def next_time() -> float:
        value = float(getattr(clock, "value", -0.25)) + 0.25
        clock.value = value
        return value

    monkeypatch.setattr(timing, "perf_counter", next_time)
    identity = ContextVar("private-fixture", default="absent")
    token = identity.set("do-not-emit-this-fixture")
    rendezvous = Barrier(4, timeout=5)
    reset_rendezvous = Barrier(4, timeout=5)

    def work(item: int) -> int:
        assert identity.get() == "absent"
        with timing.calendar_phase("http"):
            rendezvous.wait()
            return item * 2

    def next_task(item: int) -> int:
        assert identity.get() == "absent"
        # Exercise every reused worker outside calendar_worker_map. A leaked
        # accumulator would incorrectly add cal_events to the request header.
        with timing.calendar_phase("events"):
            reset_rendezvous.wait()
            return item

    try:
        with timing.collect_calendar_timing(True) as captured:
            with ThreadPoolExecutor(max_workers=4) as executor:
                assert timing.calendar_worker_map(executor, work, [1, 2, 3, 4]) == [2, 4, 6, 8]
                assert list(executor.map(next_task, [1, 2, 3, 4])) == [1, 2, 3, 4]
        assert captured is not None
        assert captured.header() == "cal_total;dur=250.000, cal_http;dur=1000.000"
    finally:
        identity.reset(token)


def test_errors_are_unchanged_and_context_is_reset_after_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    original = RuntimeError("private error text must not become a metric")
    captured = None
    with pytest.raises(RuntimeError) as raised:
        with timing.collect_calendar_timing(True) as captured:
            with timing.calendar_phase("http"):
                raise original
    assert raised.value is original
    assert captured is not None
    assert "cal_http;dur=" in captured.header()
    assert "private" not in captured.header()

    def forbidden_clock() -> None:
        raise AssertionError("The failed request left its timing context active")

    monkeypatch.setattr(timing, "perf_counter", forbidden_clock)
    with timing.calendar_phase("http"):
        pass


def test_route_checks_run_in_an_isolated_process(tmp_path: Path) -> None:
    root = tmp_path / "runtime"
    for name in ("data", "vault", "host"):
        (root / name).mkdir(parents=True)
    environment = {
        "PATH": os.defpath,
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
        "GNOSI_VALIDATION_ROOT": str(root),
        "GNOSI_DATA_DIR": str(root / "data"),
        "DIGITAL_BRAIN_VAULT_PATH": str(root / "vault"),
        "VAULT_HOST_PATH": str(root / "vault"),
        "HOME_HOST_PATH": str(root / "host"),
        "GNOSI_RUN_LIVE_E2E": "0",
        "GNOSI_DISABLE_SCHEDULER": "1",
        "GNOSI_FILES_PROVIDER": "local",
        "GNOSI_REQUIRE_AUTH": "1",
        "GNOSI_JWT_SECRET": "synthetic-calendar-timing-fixture-not-an-account-key",
    }
    result = subprocess.run(
        [
            sys.executable, "-m", "pytest", "-q", "--tb=short",
            "-o", "python_functions=check_*", "-p", "no:cacheprovider",
            "--basetemp", str(root / "tests"),
            str(Path(__file__).resolve()),
        ],
        cwd=Path(__file__).resolve().parents[4],
        env=environment,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "5 passed" in result.stdout
    sys.stdout.write(result.stdout)


@pytest.fixture(scope="module")
def calendar_modules() -> CalendarModules:
    from backend.config.validation_runtime import validation_runtime_enabled

    assert validation_runtime_enabled()
    assert "backend.api.calendar_routes" not in sys.modules
    from backend.api import calendar_routes
    from backend.services import calendar_event_aggregation
    from backend.services.integration_manager import integration_manager

    return calendar_routes, calendar_event_aggregation, integration_manager


@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize("endpoint", ["calendars", "events"])
def check_route_timing_is_opt_in_and_keeps_payload_and_provider_phases(
    monkeypatch: pytest.MonkeyPatch, calendar_modules: CalendarModules,
    enabled: bool, endpoint: str,
) -> None:
    from fastapi import Request, Response

    routes, aggregation, integrations = calendar_modules
    monkeypatch.setattr(
        integrations, "get_all_safe",
        lambda: {"calendars": [{"email": "fixture@example.invalid"}], "emails": []},
    )
    provider = [{"id": "private-fixture-id", "title": "private fixture title"}]
    local_events = [{"id": "local-fixture-id"}]

    def fetch_provider(*_args: Any) -> list[dict[str, str]]:
        with timing.calendar_phase("service"):
            with timing.calendar_phase("credentials"):
                pass
        with timing.calendar_phase("http"):
            return provider

    monkeypatch.setattr(aggregation, "list_calendars", fetch_provider)
    monkeypatch.setattr(aggregation, "list_events", fetch_provider)
    monkeypatch.setattr(routes, "_get_hidden_event_ids", lambda: set())
    monkeypatch.setattr(routes, "_get_vault_events", lambda *_args: local_events)
    routes._CALS_CACHE.clear()
    routes._EVENTS_CACHE.clear()
    response = Response()
    request = Request({
        "type": "http", "method": "GET",
        "headers": [(b"x-gnosi-calendar-timing", b"1")] if enabled else [],
    })
    try:
        if endpoint == "calendars":
            result = asyncio.run(routes.get_calendars(response, email=None, request=request))
            assert result == provider
        else:
            result = asyncio.run(routes.get_events(
                email=None, time_min="2026-09-01", time_max="2026-10-01",
                search=None, calendar_id=None, include_vault=True,
                request=request, response=response,
            ))
            assert result == provider + local_events
    finally:
        routes._CALS_CACHE.clear()
        routes._EVENTS_CACHE.clear()

    header = response.headers.get("Server-Timing")
    if not enabled:
        assert header is None
        return
    assert header is not None
    entries = dict(part.split(";dur=", 1) for part in header.split(", "))
    expected = {"cal_total", "cal_queue", "cal_integrations", f"cal_{endpoint}",
                "cal_credentials", "cal_service", "cal_http"}
    if endpoint == "events":
        expected |= {"cal_hidden_db", "cal_vault_projection"}
    assert set(entries) == expected
    assert all(float(value) >= 0 for value in entries.values())
    assert "fixture" not in header
    assert "@" not in header


def check_diagnostic_request_and_response_are_injectable_not_public_parameters(calendar_modules: CalendarModules) -> None:
    from fastapi.routing import APIRoute

    routes, _, _ = calendar_modules
    for route in routes.router.routes:
        if not isinstance(route, APIRoute) or "GET" not in (route.methods or set()):
            continue
        if route.path not in {"/api/calendar/calendars", "/api/calendar/events"}:
            continue
        assert route.dependant.request_param_name == "request"
        assert route.dependant.response_param_name == "response"
        names = {field.name for field in route.dependant.query_params}
        assert not names & {"request", "response"}
        assert not route.dependant.header_params
