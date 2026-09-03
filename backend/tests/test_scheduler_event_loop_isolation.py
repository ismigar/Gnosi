"""Regression tests for scheduler-owned bounded background execution."""

from __future__ import annotations

import asyncio
import threading
import time
from types import SimpleNamespace

import httpx
import anyio
import pytest
from fastapi import FastAPI

from backend.api import scheduler_routes
from backend.scheduler.bounded_executor import BoundedTaskExecutor, SchedulerExecutionRuntime
from backend.scheduler.manager import SchedulerManager


def test_executor_bounds_concurrency_and_coalesces_duplicate_names() -> None:
    release = threading.Event()
    both_entered = threading.Event()
    active = 0
    maximum = 0
    lock = threading.Lock()

    def slow() -> None:
        nonlocal active, maximum
        with lock:
            active += 1
            maximum = max(maximum, active)
            if active == 2:
                both_entered.set()
        release.wait(1)
        with lock:
            active -= 1

    executor = BoundedTaskExecutor(max_workers=2, max_queue_size=2)
    assert executor.submit("fetch_feeds", slow)
    assert not executor.submit("fetch_feeds", slow)
    assert executor.submit("fetch_mail", slow)
    assert both_entered.wait(1)
    release.set()
    assert executor.shutdown(timeout=1)
    assert maximum == 2


def test_executor_rejects_work_when_queue_is_full() -> None:
    release = threading.Event()
    entered = threading.Event()
    executor = BoundedTaskExecutor(max_workers=1, max_queue_size=1)

    def blocking_task() -> None:
        entered.set()
        release.wait(1)

    assert executor.submit("fetch_feeds", blocking_task)
    assert entered.wait(1)
    assert executor.submit("fetch_mail", lambda: None)
    assert not executor.submit("calendar", lambda: None)
    release.set()
    assert executor.shutdown(timeout=1)


def test_shutdown_is_bounded_when_provider_is_stuck() -> None:
    release = threading.Event()
    entered = threading.Event()
    executor = BoundedTaskExecutor(max_workers=1, max_queue_size=1)

    def stuck_provider() -> None:
        entered.set()
        release.wait(2)

    assert executor.submit("imap", stuck_provider)
    assert entered.wait(1)
    started = time.monotonic()
    assert not executor.shutdown(timeout=0.05)
    assert time.monotonic() - started < 0.25
    release.set()


def test_slow_scheduler_work_does_not_delay_asgi_health(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = object.__new__(SchedulerManager)
    manager._tasks = {"fetch_feeds": SimpleNamespace()}
    manager._execution = SchedulerExecutionRuntime()
    manager._lifecycle_lock = threading.Lock()
    started = threading.Event()
    release = threading.Event()

    def slow_run(_name: str) -> dict[str, bool]:
        started.set()
        release.wait(2)
        return {"success": True}

    monkeypatch.setattr(manager, "run_task_now", slow_run)
    assert manager.submit_task("fetch_feeds")
    assert started.wait(1)

    app = FastAPI()

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        await asyncio.sleep(0)
        return {"status": "ok"}

    async def request_health() -> tuple[int, float]:
        transport = httpx.ASGITransport(app=app)
        before = time.monotonic()
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/health")
        return response.status_code, time.monotonic() - before

    status, elapsed = asyncio.run(request_health())
    release.set()
    assert manager._execution.shutdown(timeout=1)
    assert status == 200
    assert elapsed < 0.2


def test_dedicated_pool_preserves_shared_http_worker_capacity() -> None:
    """Compare legacy shared-pool contention with scheduler-owned workers."""

    async def measure() -> tuple[float, float]:
        limiter = anyio.to_thread.current_default_thread_limiter()
        original_tokens = limiter.total_tokens
        limiter.total_tokens = 2
        try:
            return await measure_with_two_http_slots()
        finally:
            limiter.total_tokens = original_tokens

    async def measure_with_two_http_slots() -> tuple[float, float]:
        legacy_release = threading.Event()
        legacy_started = 0
        legacy_lock = threading.Lock()

        def legacy_task() -> None:
            nonlocal legacy_started
            with legacy_lock:
                legacy_started += 1
            legacy_release.wait(1)

        async with anyio.create_task_group() as group:
            group.start_soon(anyio.to_thread.run_sync, legacy_task)
            group.start_soon(anyio.to_thread.run_sync, legacy_task)
            while legacy_started < 2:
                await asyncio.sleep(0.001)
            timer = threading.Timer(0.25, legacy_release.set)
            timer.start()
            before = time.monotonic()
            await anyio.to_thread.run_sync(lambda: None)
            legacy_elapsed = time.monotonic() - before
            timer.join()

        dedicated_release = threading.Event()
        dedicated_started = threading.Event()
        executor = BoundedTaskExecutor(max_workers=2, max_queue_size=2)

        def dedicated_task() -> None:
            dedicated_started.set()
            dedicated_release.wait(1)

        assert executor.submit("fetch_feeds", dedicated_task)
        assert dedicated_started.wait(1)
        before = time.monotonic()
        await anyio.to_thread.run_sync(lambda: None)
        isolated_elapsed = time.monotonic() - before
        dedicated_release.set()
        assert executor.shutdown(timeout=1)
        return legacy_elapsed, isolated_elapsed

    legacy_elapsed, isolated_elapsed = asyncio.run(measure())
    print(
        f"shared_pool={legacy_elapsed * 1000:.1f}ms dedicated_pool={isolated_elapsed * 1000:.1f}ms"
    )
    assert legacy_elapsed >= 0.2
    assert isolated_elapsed < 0.1


def test_manual_api_uses_scheduler_pool_and_coalesces(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        scheduler_routes.scheduler_manager,
        "get_task",
        lambda _name: {"name": "fetch_feeds"},
    )
    accepted: list[bool] = [True, False]
    monkeypatch.setattr(
        scheduler_routes.scheduler_manager,
        "submit_task",
        lambda _name: accepted.pop(0),
    )

    first = asyncio.run(scheduler_routes.run_task("fetch_feeds"))
    duplicate = asyncio.run(scheduler_routes.run_task("fetch_feeds"))

    assert first.status == "running"
    assert first.success is True
    assert "enviada" in first.message
    assert duplicate.status == "running"
    assert duplicate.success is True
    assert "ja pendent" in duplicate.message
