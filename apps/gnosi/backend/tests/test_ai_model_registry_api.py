"""Tests for the configured-versus-effective AI model registry response."""

import asyncio
from types import SimpleNamespace

import yaml

from backend.agent import model_catalog, model_router
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


def test_model_registry_excludes_unchanged_persisted_defaults(monkeypatch):
    default = dict(model_router.LEGACY_DEFAULT_REGISTRY[2])
    activated = {
        "provider": "mistral",
        "model_id": "devstral-latest",
        "enabled": True,
        "priority": 100,
    }
    configured = [default, activated]
    monkeypatch.setattr(
        ai_routes,
        "load_params",
        lambda strict_env=False: {"ai": {"models": configured}},
    )
    monkeypatch.setattr(model_router, "load_registry", lambda: configured)

    response = asyncio.run(ai_routes.get_model_registry())

    assert len(response["configured_models"]) == 1
    assert response["configured_models"][0] | activated == response["configured_models"][0]


def test_budget_only_save_repairs_metadata_and_evicts_workflows(
    monkeypatch,
    tmp_path,
):
    params_path = tmp_path / "params.yaml"
    params_path.write_text(yaml.safe_dump({
        "ai": {
            "models": [{
                "provider": "mistral",
                "model_id": "devstral-latest",
                "enabled": True,
                "priority": 100,
                "cost_in": 0.4,
                "cost_out": 2.0,
                "context_window": 8192,
                "quality": 2,
                "tags": [],
            }],
        },
    }), encoding="utf-8")
    monkeypatch.setattr(
        ai_routes,
        "load_params",
        lambda strict_env=False: SimpleNamespace(params_source=params_path),
    )
    monkeypatch.setattr(
        model_catalog,
        "catalog_price_index",
        lambda: {"mistral:devstral-latest": {"cost_in": 0.4, "cost_out": 2.0}},
    )
    monkeypatch.setattr(
        model_catalog,
        "catalog_model_metadata_index",
        lambda: {
            "mistral:devstral-latest": {
                "is_local": False,
                "cost_in": 0.4,
                "cost_out": 2.0,
                "context_window": 262144,
                "quality": 2,
                "tags": ["code", "long", "tools"],
            },
        },
    )
    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(agent_cache={"old": object()})),
    )

    asyncio.run(ai_routes.set_model_registry(
        ai_routes.ModelsPayload(
            models=[{
                "provider": "mistral",
                "model_id": "devstral-latest",
                "enabled": True,
                "priority": 100,
            }],
            budget={"monthly_cost_cap": 10},
        ),
        request,
    ))

    saved = yaml.safe_load(params_path.read_text(encoding="utf-8"))
    assert saved["ai"]["models"][0]["tags"] == ["code", "long", "tools"]
    assert saved["ai"]["models"][0]["context_window"] == 262144
    assert saved["ai"]["budget"]["monthly_cost_cap"] == 10.0
    assert request.app.state.agent_cache == {}
