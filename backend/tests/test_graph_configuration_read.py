"""Graph preferences must not wait for unrelated credentials or expose them."""

from __future__ import annotations

import asyncio
from pathlib import Path
from threading import Event
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.domains.configuration.api import settings
from backend.services import workspace_service
from backend.services.context_vars import active_vault_path


def test_graph_read_excludes_other_settings_and_does_not_resolve_credentials(monkeypatch) -> None:
    params = {"graph": {"visible_tables": ["notes"], "custom_option": {"keep": True}},
              "ai": {"providers": {"fixture": {"api_key": "must-not-leak"}}},
              "settings": {"password": "must-not-leak"}, "paths": {"vault": "must-not-leak"}}

    def unexpected(*_args, **_kwargs):
        raise AssertionError("Graph must not resolve account or AI credentials")

    monkeypatch.setattr(settings, "_read_config_document", unexpected)
    monkeypatch.setattr(settings, "sanitize_ai_config_concurrently", unexpected)
    monkeypatch.setattr(settings, "load_params", lambda **_kwargs: SimpleNamespace(params=params))
    result = asyncio.run(settings.get_graph_configuration())
    assert result == {"graph": params["graph"]}
    result["graph"]["visible_tables"].append("changed")
    assert params["graph"]["visible_tables"] == ["notes"]
    params["graph"] = {"color_mode": "updated"}
    assert asyncio.run(settings.get_graph_configuration()) == {"graph": {"color_mode": "updated"}}


@pytest.mark.parametrize("params, expected", [(None, {"graph": {}}), ({}, {"graph": {}}), ({"graph": None}, {"graph": None})])
def test_graph_read_retains_missing_or_null_preferences(monkeypatch, params, expected) -> None:
    monkeypatch.setattr(settings, "load_params", lambda **_kwargs: SimpleNamespace(params=params))
    assert asyncio.run(settings.get_graph_configuration()) == expected


def test_graph_read_uses_requested_vault_and_does_not_block_other_requests(monkeypatch) -> None:
    async def scenario() -> None:
        loop = asyncio.get_running_loop()
        served = Event()

        def read(**_kwargs):
            path = active_vault_path.get()
            loop.call_soon_threadsafe(served.set)
            assert served.wait(2), "Graph preference read blocked the event loop"
            return SimpleNamespace(params={"graph": {"color_mode": str(path)}})

        monkeypatch.setattr(settings, "load_params", read)
        for vault in (Path("/first-vault"), Path("/second-vault")):
            served.clear()
            token = active_vault_path.set(vault)
            try:
                assert await settings.get_graph_configuration() == {"graph": {"color_mode": str(vault)}}
            finally:
                active_vault_path.reset(token)

    asyncio.run(scenario())


@pytest.mark.parametrize("role, status", [("owner", 200), ("viewer", 403)])
def test_graph_preferences_keep_configuration_permissions(monkeypatch, tmp_path, role, status) -> None:
    app = FastAPI()
    app.include_router(settings.router, prefix="/api")
    app.dependency_overrides[workspace_service.get_workspace_context] = lambda: (
        workspace_service.WorkspaceContext("workspace", "user", role, tmp_path)
    )
    monkeypatch.setattr(settings, "load_params", lambda **_kwargs: SimpleNamespace(params={"graph": {}}))
    with TestClient(app) as client:
        response = client.get("/api/config/graph")
    assert response.status_code == status
    if status == 200:
        assert response.json() == {"graph": {}}
