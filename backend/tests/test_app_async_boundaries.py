"""Blocking lifecycle and error operations must leave liveness responsive."""

from __future__ import annotations

import asyncio
import threading
from contextvars import ContextVar
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI


@pytest.fixture
def health_app(isolated_validation_runtime: Path) -> FastAPI:
    # Defer application imports until the disposable runtime is configured.
    from backend.app.factory import health_check

    app = FastAPI()
    app.state.health_snapshot = {"status": "ok", "mode": "FastAPI"}
    app.add_api_route("/api/health", health_check, methods=["GET"])
    return app


@pytest.mark.parametrize("notify_fails", [False, True])
def test_error_notification_leaves_health_responsive_and_keeps_context(
    health_app: FastAPI,
    monkeypatch: pytest.MonkeyPatch,
    notify_fails: bool,
) -> None:
    from backend.app import errors

    context: ContextVar[str] = ContextVar("notification_test_vault", default="unset")
    release = threading.Event()
    finished = threading.Event()
    notifications: list[tuple[str, str, str, str]] = []

    @health_app.get("/fail")
    async def fail() -> None:
        raise RuntimeError("synthetic failure")

    errors.register_error_handlers(health_app)

    async def exercise() -> None:
        loop = asyncio.get_running_loop()
        started = asyncio.Event()

        def notify(title: str, message: str, *, level: str) -> None:
            notifications.append((title, message, level, context.get()))
            loop.call_soon_threadsafe(started.set)
            try:
                # A bounded wait also makes the regression terminate on the old
                # implementation, where this callback blocked the event loop.
                assert release.wait(timeout=10), "notification was never released"
                if notify_fails:
                    raise OSError("synthetic unavailable notification channel")
            finally:
                finished.set()

        monkeypatch.setattr(errors, "_notify_fn", notify)
        token = context.set("vault-notification-test")
        try:
            transport = httpx.ASGITransport(app=health_app, raise_app_exceptions=False)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                request = asyncio.create_task(client.get("/fail"))
                try:
                    await asyncio.wait_for(started.wait(), timeout=10)
                    response = await asyncio.wait_for(client.get("/api/health"), timeout=10)
                    assert response.status_code == 200
                    assert response.json()["status"] == "ok"
                    assert not finished.is_set()
                    assert not request.done()
                finally:
                    release.set()
                    failed_response = await asyncio.wait_for(request, timeout=10)
        finally:
            context.reset(token)

        assert finished.is_set()
        assert failed_response.status_code == 500
        assert failed_response.json()["detail"] == "Internal server error"
        assert isinstance(failed_response.json()["error_id"], str)
        assert "synthetic failure" not in failed_response.text
        assert len(notifications) == 1
        title, message, level, vault_context = notifications[0]
        assert title == "Application error: GET /fail"
        assert "synthetic failure" in message
        assert level == "ERROR"
        assert vault_context == "vault-notification-test"

    asyncio.run(exercise())


@pytest.mark.parametrize("cancel_startup", [False, True])
def test_deferred_scheduler_leaves_health_responsive_and_keeps_context(
    health_app: FastAPI,
    monkeypatch: pytest.MonkeyPatch,
    cancel_startup: bool,
) -> None:
    import backend.app.lifespan as lifespan_module

    context: ContextVar[str] = ContextVar("scheduler_test_vault", default="unset")
    release = threading.Event()
    finished = threading.Event()
    events: list[tuple[str, str]] = []
    monkeypatch.setenv("GNOSI_INTEGRATION_STARTUP_DELAY_SECONDS", "0")

    def idle_stub(*, enabled: bool) -> None:
        assert enabled is False
        events.append(("idle-disabled", context.get()))

    monkeypatch.setattr(lifespan_module, "_start_mail_idle", idle_stub)

    async def exercise() -> None:
        loop = asyncio.get_running_loop()
        started = asyncio.Event()

        def start() -> None:
            events.append(("scheduler-start", context.get()))
            loop.call_soon_threadsafe(started.set)
            try:
                assert release.wait(timeout=10), "scheduler was never released"
            finally:
                finished.set()

        monkeypatch.setattr(lifespan_module, "scheduler_manager", SimpleNamespace(start=start))
        token = context.set("vault-scheduler-test")
        try:
            transport = httpx.ASGITransport(app=health_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                startup = asyncio.create_task(
                    lifespan_module._start_deferred_integrations(
                        scheduler_enabled=True, mail_enabled=False
                    )
                )
                try:
                    await asyncio.wait_for(started.wait(), timeout=10)
                    response = await asyncio.wait_for(client.get("/api/health"), timeout=10)
                    assert response.status_code == 200
                    assert response.json()["status"] == "ok"
                    assert not finished.is_set()
                    assert not startup.done()
                    assert events == [("scheduler-start", "vault-scheduler-test")]
                    if cancel_startup:
                        startup.cancel()
                        await asyncio.sleep(0)
                        assert not startup.done(), "shutdown must wait for the running start"
                finally:
                    release.set()
                    if cancel_startup:
                        with pytest.raises(asyncio.CancelledError):
                            await asyncio.wait_for(startup, timeout=10)
                    else:
                        await asyncio.wait_for(startup, timeout=10)
        finally:
            context.reset(token)

    asyncio.run(exercise())

    assert finished.is_set()
    assert events == (
        [("scheduler-start", "vault-scheduler-test")]
        if cancel_startup
        else [
            ("scheduler-start", "vault-scheduler-test"),
            ("idle-disabled", "vault-scheduler-test"),
        ]
    )


@pytest.mark.parametrize("scheduler_enabled", [False, True])
def test_deferred_scheduler_keeps_disabled_and_failure_contracts(
    health_app: FastAPI,
    monkeypatch: pytest.MonkeyPatch,
    scheduler_enabled: bool,
) -> None:
    import backend.app.lifespan as lifespan_module

    calls: list[str] = []
    failure = OSError("synthetic scheduler lock failure")
    monkeypatch.setenv("GNOSI_INTEGRATION_STARTUP_DELAY_SECONDS", "0")

    def start() -> None:
        calls.append("scheduler")
        raise failure

    def idle_stub(*, enabled: bool) -> None:
        assert enabled is False
        calls.append("idle-disabled")

    monkeypatch.setattr(lifespan_module, "scheduler_manager", SimpleNamespace(start=start))
    monkeypatch.setattr(lifespan_module, "_start_mail_idle", idle_stub)

    async def exercise() -> None:
        if scheduler_enabled:
            with pytest.raises(OSError) as caught:
                await lifespan_module._start_deferred_integrations(
                    scheduler_enabled=True, mail_enabled=False
                )
            assert caught.value is failure
            assert calls == ["scheduler"]
        else:
            await lifespan_module._start_deferred_integrations(
                scheduler_enabled=False, mail_enabled=False
            )
            assert calls == ["idle-disabled"]

    asyncio.run(exercise())
