"""Concurrency and cache regressions for the Settings configuration API."""

from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from fastapi import FastAPI, Request

from backend.domains.configuration.api import settings
from backend.domains.configuration.config_response_cache import ConfigResponseCache
from backend.domains.configuration.settings_schemas import ConfigurationUpdateRequest
from backend.security import ai_credentials
from backend.services import workspace_service


@pytest.fixture(autouse=True)
def clear_config_response_cache() -> None:
    settings._CONFIG_RESPONSE_CACHE.clear()


def test_cache_coalesces_misses_returns_copies_and_invalidates() -> None:
    cache = ConfigResponseCache(ttl_seconds=60)
    release = threading.Event()
    started = threading.Event()
    calls = 0
    results: list[dict[str, object]] = []

    def loader() -> dict[str, object]:
        nonlocal calls
        calls += 1
        started.set()
        release.wait(timeout=2)
        return {"settings": {"language": "ca"}}

    threads = [
        threading.Thread(target=lambda: results.append(cache.get_or_load("vault", loader)))
        for _ in range(2)
    ]
    for thread in threads:
        thread.start()
    assert started.wait(timeout=1)
    release.set()
    for thread in threads:
        thread.join(timeout=2)

    assert calls == 1
    assert len(results) == 2
    assert results[0] == results[1]
    assert results[0] is not results[1]
    nested = results[0]["settings"]
    assert isinstance(nested, dict)
    nested["language"] = "changed"
    assert cache.get_or_load("vault", loader) == {"settings": {"language": "ca"}}

    cache.invalidate("vault")
    assert cache.get_or_load("vault", lambda: {"settings": {"language": "fr"}}) == {
        "settings": {"language": "fr"}
    }

    with pytest.raises(RuntimeError, match="partial update"):
        cache.update("vault", lambda: (_ for _ in ()).throw(RuntimeError("partial update")))
    assert cache.get_or_load("vault", lambda: {"settings": {"language": "en"}}) == {
        "settings": {"language": "en"}
    }


def test_secret_status_checks_are_parallel_and_never_return_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    providers = {
        f"provider-{index}": {
            "api_key": f"private-{index}",
            "credential_ref": f"__keychain__:provider_{index}",
        }
        for index in range(6)
    }
    queried: list[str] = []
    query_lock = threading.Lock()

    def slow_has_key(provider_id: str, _config: object) -> bool:
        time.sleep(0.15)
        with query_lock:
            queried.append(provider_id)
        return True

    monkeypatch.setattr(ai_credentials, "has_provider_api_key", slow_has_key)
    started = time.perf_counter()
    result = ai_credentials.sanitize_ai_config_concurrently({"providers": providers})
    elapsed = time.perf_counter() - started

    assert elapsed < 0.5
    assert set(queried) == set(providers)
    sanitized = result["providers"]
    assert isinstance(sanitized, dict)
    assert list(sanitized) == list(providers)
    assert all("api_key" not in config for config in sanitized.values())
    assert "private-" not in repr(result)


def test_health_http_response_is_not_blocked_by_slow_config_read(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    started = threading.Event()
    release = threading.Event()

    def slow_read() -> dict[str, object]:
        started.set()
        release.wait(timeout=2)
        return {}

    monkeypatch.setattr(settings, "_read_config_document", slow_read)
    monkeypatch.setattr(settings, "_config_context_key", lambda: "fixture")

    app = FastAPI()
    app.include_router(settings.router, prefix="/api")
    app.dependency_overrides[workspace_service.get_workspace_context] = lambda: (
        workspace_service.WorkspaceContext("fixture", "user", "owner", tmp_path)
    )

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    async def exercise() -> float:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            config_task = asyncio.create_task(client.get("/api/config"))
            assert await asyncio.to_thread(started.wait, 1)
            before = time.perf_counter()
            response = await client.get("/api/health")
            elapsed = time.perf_counter() - before
            assert response.json() == {"status": "ok"}
            assert not config_task.done()
            release.set()
            assert (await config_task).status_code == 200
            return elapsed

    assert asyncio.run(exercise()) < 0.2


def test_health_http_response_is_not_blocked_by_slow_config_update(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    started = threading.Event()
    release = threading.Event()

    def slow_update(_new_config: dict[str, Any]) -> None:
        started.set()
        release.wait(timeout=2)

    monkeypatch.setattr(settings, "_update_config_document", slow_update)
    monkeypatch.setattr(settings, "_config_context_key", lambda: "fixture")

    app = FastAPI()
    app.include_router(settings.router, prefix="/api")
    app.dependency_overrides[workspace_service.get_workspace_context] = lambda: (
        workspace_service.WorkspaceContext("fixture", "user", "owner", tmp_path)
    )

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    async def exercise() -> float:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            update_task = asyncio.create_task(
                client.post("/api/config", json={"settings": {"language": "fr"}})
            )
            assert await asyncio.to_thread(started.wait, 1)
            before = time.perf_counter()
            response = await client.get("/api/health")
            elapsed = time.perf_counter() - before
            assert response.json() == {"status": "ok"}
            assert not update_task.done()
            release.set()
            assert (await update_task).status_code == 200
            return elapsed

    assert asyncio.run(exercise()) < 0.2


def test_post_runs_blocking_transaction_off_loop_and_invalidates_get(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored: dict[str, Any] = {"settings": {"language": "ca"}}
    update_started = threading.Event()
    release_update = threading.Event()
    event_loop_thread = threading.get_ident()
    update_threads: list[int] = []

    monkeypatch.setattr(settings, "_config_context_key", lambda: "fixture")
    monkeypatch.setattr(settings, "_read_config_document", lambda: stored.copy())

    def slow_update(new_config: dict[str, Any]) -> None:
        update_threads.append(threading.get_ident())
        update_started.set()
        release_update.wait(timeout=2)
        stored.update(new_config)

    monkeypatch.setattr(settings, "_update_config_document", slow_update)
    app = SimpleNamespace(state=SimpleNamespace(agent_cache={}))
    request = Request({"type": "http", "app": app})
    payload = ConfigurationUpdateRequest({"settings": {"language": "fr"}})

    async def exercise() -> None:
        assert await settings.get_config() == {"settings": {"language": "ca"}}
        update_task = asyncio.create_task(settings.update_config(payload, request))
        assert await asyncio.to_thread(update_started.wait, 1)
        await asyncio.sleep(0)
        assert not update_task.done()
        release_update.set()
        assert await update_task == {
            "status": "success",
            "message": "Configuration updated",
        }
        assert await settings.get_config() == {"settings": {"language": "fr"}}

    asyncio.run(exercise())
    assert update_threads and update_threads[0] != event_loop_thread
