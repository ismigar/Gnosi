"""Editors load editable values without querying unrelated credential stores."""

from __future__ import annotations

import asyncio
import copy
from pathlib import Path
from threading import Event
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.domains.configuration.api import settings
from backend.security import ai_credentials, keychain_manager
from backend.services import workspace_service
from backend.services.context_vars import active_vault_path


def test_editor_preserves_values_and_extensions_without_reading_credentials(monkeypatch) -> None:
    params = {
        "settings": {"password": "system-secret", "has_password": True, "gnosi_mode": "org", "custom": [1]},
        "paths": {"vault": "stored-path", "custom": "kept"},
        "graph": {"visible_tables": ["notes"]},
        "ai": {
            "agents": [{"id": "fixture", "custom": {"kept": True}}],
            "active_agent_id": "fixture",
            "providers": {
                "openai": {"api_key": "provider-secret", "has_api_key": True, "enabled": False, "custom": [2]},
                "custom": {"credential_ref": "__keychain__:custom-secret"},
                "empty": None,
            },
            "custom": {"kept": True},
        },
        "extension": {"kept": True},
    }
    original = copy.deepcopy(params)
    monkeypatch.setenv("VAULT_HOST_PATH", "displayed-path")
    monkeypatch.setattr(settings, "load_params", lambda **_: SimpleNamespace(params=params, paths={"VAULT": Path("resolved-path")}))

    def unexpected(*_args, **_kwargs):
        raise AssertionError("Editor read queried credential availability")

    monkeypatch.setattr(settings, "sanitize_ai_config_concurrently", unexpected)
    monkeypatch.setattr(ai_credentials, "has_provider_api_key", unexpected)
    monkeypatch.setattr(keychain_manager, "get_keychain", unexpected)
    result = asyncio.run(settings.get_editor_configuration())
    assert result["settings"] == {"gnosi_mode": "org", "custom": [1]}
    assert result["paths"] == {"vault": "displayed-path", "custom": "kept"}
    assert result["ai"]["providers"] == {
        "openai": {"enabled": False, "custom": [2], "credential_ref": "__keychain__:openai_api_key"},
        "custom": {"credential_ref": "__keychain__:custom-secret", "enabled": True},
        "empty": {"credential_ref": "__keychain__:ai_provider_empty_credential", "enabled": True},
    }
    assert result["ai"]["agents"] == params["ai"]["agents"]
    assert result["ai"]["active_agent_id"] == "fixture"
    assert result["ai"]["custom"] == {"kept": True}
    assert result["extension"] == {"kept": True}
    assert "system-secret" not in repr(result) and "provider-secret" not in repr(result)
    result["graph"]["visible_tables"].append("changed")
    result["ai"]["agents"][0]["custom"]["kept"] = False
    assert params == original
    params["settings"]["gnosi_mode"] = "personal"
    assert asyncio.run(settings.get_editor_configuration())["settings"]["gnosi_mode"] == "personal"


@pytest.mark.parametrize("params", [None, {}, {"ai": None, "settings": None}])
def test_editor_retains_empty_configuration_defaults(monkeypatch, params) -> None:
    monkeypatch.delenv("VAULT_HOST_PATH", raising=False)
    monkeypatch.setattr(settings, "load_params", lambda **_: SimpleNamespace(params=params, paths={}))
    result = asyncio.run(settings.get_editor_configuration())
    assert result["ai"] == {"providers": {}}
    assert result["paths"] == {}


def test_full_configuration_still_reports_credential_status(monkeypatch) -> None:
    params = {"settings": {"gnosi_mode": "personal"}, "ai": {"providers": {"fixture": {}}}}
    monkeypatch.delenv("VAULT_HOST_PATH", raising=False)
    monkeypatch.setattr(settings, "load_params", lambda **_: SimpleNamespace(params=params, paths={}))
    monkeypatch.setattr(keychain_manager, "get_keychain", lambda: SimpleNamespace(has_credential=lambda _: True))
    monkeypatch.setattr(ai_credentials, "has_provider_api_key", lambda *_: True)
    complete = settings._read_config_document()
    assert complete["settings"]["has_password"] is True
    assert complete["ai"]["providers"]["fixture"]["has_api_key"] is True
    complete["settings"].pop("has_password")
    complete["ai"]["providers"]["fixture"].pop("has_api_key")
    assert settings._read_editor_document() == complete


def test_editor_read_preserves_vault_context_and_leaves_the_loop_available(monkeypatch) -> None:
    async def scenario() -> None:
        loop = asyncio.get_running_loop()
        served = Event()

        def read(**_kwargs):
            path = active_vault_path.get()
            loop.call_soon_threadsafe(served.set)
            assert served.wait(2), "Editor read blocked the event loop"
            return SimpleNamespace(params={"settings": {"workspace_name": str(path)}}, paths={})

        monkeypatch.setattr(settings, "load_params", read)
        for vault in (Path("/first-vault"), Path("/second-vault")):
            served.clear()
            token = active_vault_path.set(vault)
            try:
                result = await settings.get_editor_configuration()
                assert result["settings"]["workspace_name"] == str(vault)
            finally:
                active_vault_path.reset(token)

    asyncio.run(scenario())


@pytest.mark.parametrize("role, status", [("owner", 200), ("viewer", 403)])
def test_editor_configuration_keeps_the_configuration_permission_gate(monkeypatch, tmp_path, role, status) -> None:
    app = FastAPI()
    app.include_router(settings.router, prefix="/api")
    app.dependency_overrides[workspace_service.get_workspace_context] = lambda: (
        workspace_service.WorkspaceContext("workspace", "user", role, tmp_path)
    )
    monkeypatch.setattr(settings, "load_params", lambda **_: SimpleNamespace(params={}, paths={}))
    with TestClient(app) as client:
        response = client.get("/api/config/editor")
    assert response.status_code == status
    if status == 200:
        assert response.json()["ai"] == {"providers": {}}
