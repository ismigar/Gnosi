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
    from backend.domains.configuration.config_response_cache import configuration_response_cache
    configuration_response_cache.get_or_load("model-bindings-test", lambda: {"old": True})

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
    assert configuration_response_cache.get_or_load("model-bindings-test", lambda: {"new": True}) == {"new": True}


def test_registry_rejects_a_concurrent_stale_writer(monkeypatch, tmp_path):
    from fastapi import HTTPException
    from backend.domains.configuration.ai.registry_revision import registry_revision

    params_path = tmp_path / "params.yaml"
    initial = {"ai": {"models": [], "budget": {"monthly_usd": 10}}}
    params_path.write_text(yaml.safe_dump(initial))

    class Config(dict):
        @property
        def params_source(self):
            return params_path

    monkeypatch.setattr(ai_routes, "load_params", lambda strict_env=False: Config(yaml.safe_load(params_path.read_text())))
    monkeypatch.setattr(model_catalog, "catalog_price_index", lambda: {})
    monkeypatch.setattr(model_catalog, "catalog_model_metadata_index", lambda: {})
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(agent_cache={})))
    revision = registry_revision(initial["ai"])

    async def write_both():
        return await asyncio.gather(*[
            ai_routes.set_model_registry(ai_routes.ModelsPayload(
                models=[{"provider": "custom", "model_id": name}], expected_revision=revision,
            ), request) for name in ("first", "second")
        ], return_exceptions=True)

    results = asyncio.run(write_both())
    errors = [result for result in results if isinstance(result, HTTPException)]
    assert len(errors) == 1
    assert errors[0].status_code == 409
    saved = yaml.safe_load(params_path.read_text())["ai"]
    assert len(saved["models"]) == 1
    assert saved["budget"] == initial["ai"]["budget"]


def test_disabling_assigned_model_requires_fresh_confirmation(monkeypatch, tmp_path):
    import pytest
    from fastapi import HTTPException
    from backend.domains.configuration.ai.model_bindings import detach_models
    from backend.services.agent_model_strategy import validate_model_strategies

    row = {"provider": "openai", "model_id": "test", "enabled": True}
    agent = {"id": "reader", "name": "Reader", "provider": "openai", "model": "test", "persona": "Preserve me", "skill_ids": ["read"], "enabled": True}
    params_path = tmp_path / "params.yaml"
    config = {"ai": {"models": [row], "agents": [agent]}}
    params_path.write_text(yaml.safe_dump(config))
    class Config(dict):
        params_source = params_path
    monkeypatch.setattr(ai_routes, "load_params", lambda strict_env=False: Config(yaml.safe_load(params_path.read_text())))
    monkeypatch.setattr(model_catalog, "catalog_price_index", lambda: {})
    monkeypatch.setattr(model_catalog, "catalog_model_metadata_index", lambda: {})
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(agent_cache={})))
    disabled = {**row, "enabled": False}
    with pytest.raises(HTTPException) as error:
        asyncio.run(ai_routes.set_model_registry(ai_routes.ModelsPayload(models=[disabled]), request))
    assert error.value.status_code == 409
    assert yaml.safe_load(params_path.read_text()) == config
    detail = error.value.detail
    assert detail["agents"] == [{"id": "reader", "name": "Reader"}]
    # Adding another assignment invalidates the reviewed confirmation.
    changed = {"ai": {"models": [row], "agents": [agent, {**agent, "id": "other"}]}}
    params_path.write_text(yaml.safe_dump(changed))
    with pytest.raises(HTTPException) as stale:
        asyncio.run(ai_routes.set_model_registry(ai_routes.ModelsPayload(models=[disabled], detach_agents_revision=detail["confirmation_revision"]), request))
    assert stale.value.detail["confirmation_revision"] != detail["confirmation_revision"]
    asyncio.run(ai_routes.set_model_registry(ai_routes.ModelsPayload(models=[disabled], detach_agents_revision=stale.value.detail["confirmation_revision"]), request))
    saved = yaml.safe_load(params_path.read_text())
    assert saved["ai"]["models"][0]["enabled"] is False
    assert saved["ai"]["agents"][0] == {**agent, "provider": "", "model": "", "reasoning_effort": None}
    with pytest.raises(ValueError, match="disabled model"):
        validate_model_strategies([agent], [disabled])
    alternatives = {**agent, "provider": "other", "model": "active", "model_strategy": {"allowed_models": [{"provider": "openai", "model": "test"}]}, "team": {"temporary": {"models": [{"provider": "openai", "model": "test"}]}}}
    detached, affected, _ = detach_models([alternatives], {("openai", "test")})
    assert affected
    assert detached[0]["model_strategy"]["allowed_models"] == []
    assert detached[0]["team"]["temporary"]["models"] == []
    assert alternatives["model_strategy"]["allowed_models"]  # Original is untouched.


def test_settings_cannot_disable_a_bound_model_or_restore_its_assignment(monkeypatch):
    import pytest
    from fastapi import HTTPException
    from backend.domains.configuration.api.settings import _validate_agent_strategies

    disabled = {"provider": "openai", "model_id": "test", "enabled": False}
    agent = {"id": "reader", "name": "Reader", "provider": "openai", "model": "test"}
    monkeypatch.setattr(model_router, "load_registry", lambda: [disabled])
    for payload in ({"ai": {"agents": [agent]}}, {"ai": {"models": [disabled]}}):
        with pytest.raises(HTTPException) as error:
            _validate_agent_strategies(payload, {"ai": {"agents": [agent], "models": [disabled]}})
        assert error.value.status_code == 400
        assert "disabled model" in error.value.detail
