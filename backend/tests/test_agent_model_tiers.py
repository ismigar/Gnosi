"""Tests for opt-in model tiers, automatic same-locality fallback, and Gauntlet reviewer tier."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from backend.services.agent_model_tiers import (
    ModelTierRoute,
    ModelTiersConfig,
    apply_gauntlet_reviewer_tier,
    normalize_model_tiers,
    resolve_tier_route,
    save_model_tiers,
    validate_model_tiers,
)


def _registry() -> list[dict[str, Any]]:
    return [
        {"provider": "openai", "model_id": "gpt-4o-mini", "enabled": True, "tags": ["tools"], "context_window": 128000},
        {"provider": "anthropic", "model_id": "claude-sonnet", "enabled": True, "tags": ["tools"], "context_window": 200000},
        {"provider": "openrouter", "model_id": "deepseek-r1", "enabled": True, "tags": ["tools"], "context_window": 128000},
        {"provider": "ollama", "model_id": "llama3.2", "enabled": True, "tags": ["tools"], "context_window": 32000, "is_local": True},
        {"provider": "ollama", "model_id": "qwen2.5", "enabled": True, "tags": ["tools"], "context_window": 32000, "is_local": True},
        {"provider": "openai", "model_id": "disabled-model", "enabled": False, "tags": ["tools"], "context_window": 128000},
    ]


def test_normalize_and_validate_model_tiers_deduplicates_and_rejects_disabled() -> None:
    ai_cfg = {
        "model_tiers": {
            "standard": [
                {"provider": "OpenAI", "model": "gpt-4o-mini"},
                {"provider": "openai", "model": "gpt-4o-mini"},
                {"provider": "anthropic", "model": "claude-sonnet"},
            ]
        },
        "gauntlet_reviewer_tier": "ADVANCED",
    }
    normalized = normalize_model_tiers(ai_cfg)
    assert normalized["standard"] == [
        {"provider": "openai", "model": "gpt-4o-mini"},
        {"provider": "anthropic", "model": "claude-sonnet"},
    ]
    assert normalized["gauntlet_reviewer_tier"] == "advanced"

    validated = validate_model_tiers(normalized, _registry())
    assert len(validated["standard"]) == 2

    with pytest.raises(ValueError, match="disabled or unknown"):
        validate_model_tiers(
            {"standard": [{"provider": "openai", "model": "disabled-model"}]},
            _registry(),
        )


def test_resolve_tier_route_preserves_pinned_default_and_enforces_opt_in_fallback() -> None:
    ai_cfg = {
        "model_tiers": {
            "standard": [
                {"provider": "openai", "model": "gpt-4o-mini"},
                {"provider": "anthropic", "model": "claude-sonnet"},
                {"provider": "openrouter", "model": "deepseek-r1"},
            ]
        }
    }
    # No tier -> returns None (keeps pinned behavior)
    assert (
        resolve_tier_route(
            {"id": "a1", "provider": "openai", "model": "gpt-4o-mini"},
            ai_cfg,
            _registry(),
            is_available=lambda _: True,
            usage={},
            budget={},
        )
        is None
    )

    # Tier without fallback -> primary only, empty fallbacks
    prov, model, strategy = resolve_tier_route(
        {"id": "a1", "provider": "openai", "model": "gpt-4o-mini", "model_tier": "standard", "model_tier_fallback": False},
        ai_cfg,
        _registry(),
        is_available=lambda _: True,
        usage={},
        budget={},
    ) or ("", None, {})
    assert (prov, model) == ("openai", "gpt-4o-mini")
    assert strategy["mode"] == "tier"
    assert strategy["fallback_models"] == []

    # Tier with fallback -> ordered same-locality fallbacks populated
    prov, model, strategy = resolve_tier_route(
        {"id": "a1", "provider": "openai", "model": "gpt-4o-mini", "model_tier": "standard", "model_tier_fallback": True},
        ai_cfg,
        _registry(),
        is_available=lambda _: True,
        usage={},
        budget={},
    ) or ("", None, {})
    assert (prov, model) == ("openai", "gpt-4o-mini")
    assert strategy["mode"] == "tier_fallback"
    assert strategy["fallback_models"] == [
        {"provider": "anthropic", "model": "claude-sonnet"},
        {"provider": "openrouter", "model": "deepseek-r1"},
    ]

    # When fallback is disabled and primary is unavailable -> no silent fallback
    assert (
        resolve_tier_route(
            {"id": "a1", "provider": "openai", "model": "gpt-4o-mini", "model_tier": "standard", "model_tier_fallback": False},
            ai_cfg,
            _registry(),
            is_available=lambda p: p != "openai",
            usage={},
            budget={},
        )
        is None
    )

    # When primary provider is unavailable and fallback enabled -> promotes secondary
    prov2, model2, strategy2 = resolve_tier_route(
        {"id": "a1", "provider": "openai", "model": "gpt-4o-mini", "model_tier": "standard", "model_tier_fallback": True},
        ai_cfg,
        _registry(),
        is_available=lambda p: p != "openai",
        usage={},
        budget={},
    ) or ("", None, {})
    assert (prov2, model2) == ("anthropic", "claude-sonnet")
    assert strategy2["selection_reason"] == "model_tier_fallback"
    assert strategy2["fallback_models"] == [{"provider": "openrouter", "model": "deepseek-r1"}]


def test_resolve_tier_route_enforces_local_provider_boundary() -> None:
    ai_cfg = {
        "model_tiers": {
            "minimal": [
                {"provider": "openai", "model": "gpt-4o-mini"},
                {"provider": "ollama", "model": "llama3.2"},
                {"provider": "ollama", "model": "qwen2.5"},
            ]
        }
    }
    prov, model, strategy = resolve_tier_route(
        {"id": "local-bot", "provider": "ollama", "model": "llama3.2", "model_tier": "minimal", "model_tier_fallback": True},
        ai_cfg,
        _registry(),
        is_available=lambda _: True,
        usage={},
        budget={},
    ) or ("", None, {})
    assert (prov, model) == ("ollama", "llama3.2")
    assert strategy["selection_reason"] == "model_tier_primary"
    assert strategy["fallback_models"] == [{"provider": "ollama", "model": "qwen2.5"}]


def test_gauntlet_reviewer_tier_switches_within_same_locality_and_clears_source_tier() -> None:
    ai_cfg = {
        "model_tiers": {
            "minimal": [{"provider": "openai", "model": "gpt-4o-mini"}],
            "advanced": [
                {"provider": "anthropic", "model": "claude-sonnet"},
                {"provider": "ollama", "model": "qwen2.5"},
            ],
        },
        "gauntlet_reviewer_tier": "advanced",
    }
    cloud_profile: dict[str, Any] = {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "openrouter_route": {"model": "x", "provider": "y"},
        "model_tier": "minimal",
        "model_tier_fallback": True,
    }
    apply_gauntlet_reviewer_tier(cloud_profile, ai_cfg=ai_cfg, registry=_registry())
    assert (cloud_profile["provider"], cloud_profile["model"]) == ("anthropic", "claude-sonnet")
    assert cloud_profile["openrouter_route"] is None
    assert cloud_profile["model_tier"] == ""
    assert cloud_profile["model_tier_fallback"] is False
    assert (
        resolve_tier_route(cloud_profile, ai_cfg, _registry(), is_available=lambda _: True, usage={}, budget={})
        is None
    )

    local_profile: dict[str, Any] = {"provider": "ollama", "model": "llama3.2", "model_tier": "minimal"}
    apply_gauntlet_reviewer_tier(local_profile, ai_cfg=ai_cfg, registry=_registry())
    assert (local_profile["provider"], local_profile["model"]) == ("ollama", "qwen2.5")
    assert local_profile["model_tier"] == ""


def test_save_model_tiers_persists_to_params_yaml(tmp_path: Path, monkeypatch: Any) -> None:
    params_file = tmp_path / "params.yaml"
    params_file.write_text("ai:\n  active_agent_id: personal\n", encoding="utf-8")
    monkeypatch.setattr("backend.agent.model_router.load_registry", _registry)
    monkeypatch.setattr(
        "backend.config.app_config.load_params",
        lambda strict_env=False: SimpleNamespace(params_source=str(params_file), ai={}),
    )
    saved = save_model_tiers(
        ModelTiersConfig(
            standard=[ModelTierRoute(provider="openai", model="gpt-4o-mini")],
            gauntlet_reviewer_tier="standard",
        )
    )
    assert saved["standard"] == [{"provider": "openai", "model": "gpt-4o-mini"}]
    assert "model_tiers:" in params_file.read_text(encoding="utf-8")
