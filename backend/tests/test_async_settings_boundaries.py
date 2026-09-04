"""Regression tests for blocking Settings operations in async routes."""

from __future__ import annotations

import asyncio
import threading
from typing import Any

import pytest

from backend.api import identity_routes, integrations_routes, social_routes, system_routes
from backend.domains.configuration.api import settings


def _assert_worker_thread(call: Any) -> None:
    event_loop_thread = threading.get_ident()
    worker_threads: list[int] = []

    def blocking_call(*_args: object, **_kwargs: object) -> Any:
        worker_threads.append(threading.get_ident())
        return {}

    asyncio.run(call(blocking_call))
    assert worker_threads
    assert worker_threads[0] != event_loop_thread


def test_configuration_read_runs_off_event_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    async def invoke(blocking_call: Any) -> None:
        monkeypatch.setattr(settings, "_read_config_document", blocking_call)
        assert await settings.get_config() == {}

    _assert_worker_thread(invoke)


def test_integrations_read_runs_off_event_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    async def invoke(blocking_call: Any) -> None:
        monkeypatch.setattr(
            integrations_routes.integration_manager,
            "get_all_safe",
            blocking_call,
        )
        assert await integrations_routes.get_integrations() == {}

    _assert_worker_thread(invoke)


def test_social_stream_read_runs_off_event_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    async def invoke(blocking_call: Any) -> None:
        monkeypatch.setattr(social_routes, "_configured_streams", blocking_call)
        assert await social_routes.get_streams() == {}

    _assert_worker_thread(invoke)


def test_directory_browse_runs_off_event_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    request = system_routes.BrowseRequest(path="")

    async def invoke(blocking_call: Any) -> None:
        monkeypatch.setattr(system_routes, "_browse_directory", blocking_call)
        assert await system_routes.browse_directory(request) == {}

    _assert_worker_thread(invoke)


def test_identity_read_runs_off_event_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    async def invoke(blocking_call: Any) -> None:
        monkeypatch.setattr(identity_routes, "_read_identity", blocking_call)
        assert await identity_routes.get_identity() == {}

    _assert_worker_thread(invoke)
