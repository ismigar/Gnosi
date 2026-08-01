"""Coverage for the configured model guard in the vault summary plugin."""

import pytest
from fastapi import HTTPException

import backend.api.vault_routes as vault_routes


def test_configured_summary_model_accepts_an_active_model(monkeypatch):
    monkeypatch.setattr(
        vault_routes,
        "_load_plugins_state",
        lambda: {"settings": {"vault-summary": {"model": "ollama:llama3.2"}}},
    )
    monkeypatch.setattr(
        "backend.agent.model_router.load_registry",
        lambda: [{"provider": "ollama", "model_id": "llama3.2", "enabled": True}],
    )

    assert vault_routes._configured_summary_model() == ("ollama", "llama3.2")


def test_configured_summary_model_rejects_an_inactive_model(monkeypatch):
    monkeypatch.setattr(
        vault_routes,
        "_load_plugins_state",
        lambda: {"settings": {"vault-summary": {"model": "openai:gpt-4o"}}},
    )
    monkeypatch.setattr(
        "backend.agent.model_router.load_registry",
        lambda: [{"provider": "openai", "model_id": "gpt-4o", "enabled": False}],
    )

    with pytest.raises(HTTPException) as error:
        vault_routes._configured_summary_model()

    assert error.value.status_code == 409
