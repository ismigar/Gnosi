"""Tests for the configured-versus-effective AI model registry response."""

import asyncio

from backend.agent import model_router
from backend.api import ai_routes


def test_model_registry_keeps_runtime_defaults_out_of_configured_models(monkeypatch):
    runtime_default = {
        "provider": "openai",
        "model_id": "runtime-default",
        "enabled": True,
    }
    monkeypatch.setattr(ai_routes, "load_params", lambda strict_env=False: {"ai": {}})
    monkeypatch.setattr(model_router, "load_registry", lambda: [runtime_default])

    response = asyncio.run(ai_routes.get_model_registry())

    assert response["models"] == [runtime_default]
    assert response["configured_models"] == []


def test_model_registry_returns_explicit_rows_separately(monkeypatch):
    configured = [
        {"provider": "openai", "model_id": "active", "enabled": True},
        {"provider": "openai", "model_id": "inactive", "enabled": False},
    ]
    monkeypatch.setattr(
        ai_routes,
        "load_params",
        lambda strict_env=False: {"ai": {"models": configured}},
    )
    monkeypatch.setattr(model_router, "load_registry", lambda: configured)

    response = asyncio.run(ai_routes.get_model_registry())

    assert response["configured_models"] == configured
