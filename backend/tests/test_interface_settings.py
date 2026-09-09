"""Display preferences must not wait for secret checks or leak configuration."""

from __future__ import annotations

import asyncio
from pathlib import Path
from threading import Event
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from backend.domains.configuration.api import settings
from backend.services import workspace_service
from backend.services.context_vars import active_vault_path


def test_display_preferences_exclude_secrets_without_resolving_them(monkeypatch) -> None:
    def unexpected(*_args, **_kwargs):
        raise AssertionError("Display preferences must not resolve credentials")

    monkeypatch.setattr(settings, "_read_config_document", unexpected)
    monkeypatch.setattr(settings, "sanitize_ai_config_concurrently", unexpected)
    monkeypatch.setattr(
        settings,
        "load_params",
        lambda **_kwargs: SimpleNamespace(settings={
            "language": "ca", "currency": "USD", "date_format": "iso",
            "decimal_symbol": ".", "password": "must-not-leak",
            "credential_ref": "must-not-leak", "future_setting": "must-not-leak",
        }),
    )
    result = asyncio.run(settings.get_interface_settings())
    assert result.model_dump() == {
        "language": "ca", "currency": "USD", "date_format": "iso", "decimal_symbol": ".",
    }


def test_display_preferences_read_fresh_values_and_use_defaults(monkeypatch) -> None:
    values = {"language": "", "currency": None, "date_format": 42}
    monkeypatch.setattr(
        settings, "load_params", lambda **_kwargs: SimpleNamespace(settings=values),
    )
    assert asyncio.run(settings.get_interface_settings()).model_dump() == {
        "language": "en", "currency": "EUR", "date_format": "locale", "decimal_symbol": ",",
    }
    values["language"] = "fr"
    assert asyncio.run(settings.get_interface_settings()).language == "fr"


def test_slow_preference_read_preserves_vault_context_without_blocking(monkeypatch) -> None:
    async def scenario() -> None:
        loop = asyncio.get_running_loop()
        other_request_served = Event()

        def slow_read(**_kwargs):
            assert active_vault_path.get() == Path("/requested-vault")
            loop.call_soon_threadsafe(other_request_served.set)
            assert other_request_served.wait(2), "Preference read blocked the request loop"
            return SimpleNamespace(settings={"language": "ca"})

        monkeypatch.setattr(settings, "load_params", slow_read)
        token = active_vault_path.set(Path("/requested-vault"))
        try:
            assert (await settings.get_interface_settings()).language == "ca"
        finally:
            active_vault_path.reset(token)

    asyncio.run(scenario())


@pytest.mark.parametrize("role, status", [("owner", 200), ("viewer", 403)])
def test_display_preferences_keep_the_configuration_permission_gate(
    monkeypatch, tmp_path: Path, role: str, status: int,
) -> None:
    app = FastAPI()
    app.include_router(settings.router, prefix="/api")
    app.dependency_overrides[workspace_service.get_workspace_context] = lambda: (
        workspace_service.WorkspaceContext("workspace", "user", role, tmp_path)
    )
    monkeypatch.setattr(
        settings, "load_params", lambda **_kwargs: SimpleNamespace(settings={"language": "ca"}),
    )
    with TestClient(app) as client:
        response = client.get("/api/config/interface")
    assert response.status_code == status
    if status == 200:
        assert response.json()["language"] == "ca"
