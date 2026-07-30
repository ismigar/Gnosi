"""Unit tests for the protected LLM Wiki agent lifecycle."""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.services.llm_wiki_agent import (
    LLM_WIKI_AGENT_ID,
    LLM_WIKI_AGENT_MARKER,
    LLM_WIKI_REQUIRED_SKILL_IDS,
    LLM_WIKI_SKILL_IDS,
    LlmWikiAgentError,
    ensure_agent,
    remove_agent,
    suspend_agent,
    validate_agent_preserved,
)


def _configured_agent(agent_id: str, **extra):
    return {
        "id": agent_id,
        "name": agent_id,
        "provider": "openai",
        "model": "gpt-test",
        "enabled": True,
        **extra,
    }


def test_ensure_agent_uses_active_model_and_is_idempotent():
    ai = {
        "active_agent_id": "active",
        "agents": [_configured_agent("other", model="other-model"), _configured_agent("active")],
    }

    created, changed = ensure_agent(ai)
    profile = next(agent for agent in created["agents"] if agent["id"] == LLM_WIKI_AGENT_ID)

    assert changed is True
    assert profile["managed_by"] == LLM_WIKI_AGENT_MARKER
    assert profile["provider"] == "openai"
    assert profile["model"] == "gpt-test"
    assert profile["enabled"] is True
    assert profile["skill_ids"] == LLM_WIKI_SKILL_IDS
    assert profile["required_skill_ids"] == LLM_WIKI_REQUIRED_SKILL_IDS

    profile["persona"] = "Instruccions personals"
    repeated, changed = ensure_agent(created)
    assert changed is False
    assert next(agent for agent in repeated["agents"] if agent["id"] == LLM_WIKI_AGENT_ID)["persona"] == "Instruccions personals"


def test_ensure_agent_migrates_skills_and_resumes_without_overwriting_edits():
    current = {
        "agents": [{
            **_configured_agent(LLM_WIKI_AGENT_ID),
            "managed_by": LLM_WIKI_AGENT_MARKER,
            "persona": "Custom persona",
            "plugin_suspended": True,
            "plugin_enabled_before_suspend": True,
            "enabled": False,
        }],
    }

    updated, changed = ensure_agent(current)
    profile = updated["agents"][0]

    assert changed is True
    assert profile["skill_ids"] == LLM_WIKI_SKILL_IDS
    assert profile["required_skill_ids"] == LLM_WIKI_REQUIRED_SKILL_IDS
    assert profile["persona"] == "Custom persona"
    assert profile["enabled"] is True
    assert "plugin_suspended" not in profile
    assert "plugin_enabled_before_suspend" not in profile


def test_ensure_agent_replaces_only_the_synthetic_legacy_skill_bundle():
    legacy = {
        "agents": [{
            **_configured_agent(LLM_WIKI_AGENT_ID),
            "managed_by": LLM_WIKI_AGENT_MARKER,
            "persona": "Keep me",
            "skill_ids": ["core.legacy-default-v1"],
        }],
    }

    migrated, changed = ensure_agent(legacy)

    assert changed is True
    assert migrated["agents"][0]["skill_ids"] == LLM_WIKI_SKILL_IDS
    assert migrated["agents"][0]["required_skill_ids"] == (
        LLM_WIKI_REQUIRED_SKILL_IDS
    )
    assert migrated["agents"][0]["persona"] == "Keep me"

    customized = {
        "agents": [{
            **_configured_agent(LLM_WIKI_AGENT_ID),
            "managed_by": LLM_WIKI_AGENT_MARKER,
            "skill_ids": ["user.my-own-skill"],
        }],
    }
    migrated_custom, changed_custom = ensure_agent(customized)

    assert changed_custom is True
    assert migrated_custom["agents"][0]["skill_ids"] == ["user.my-own-skill"]
    assert migrated_custom["agents"][0]["required_skill_ids"] == (
        LLM_WIKI_REQUIRED_SKILL_IDS
    )


def test_ensure_agent_without_model_stays_disabled():
    created, changed = ensure_agent({"agents": []})
    profile = created["agents"][0]

    assert changed is True
    assert profile["enabled"] is False
    assert profile["provider"] == ""
    assert profile["model"] == ""


def test_reserved_id_owned_by_user_is_never_overwritten_or_removed():
    ai = {"agents": [_configured_agent(LLM_WIKI_AGENT_ID)]}

    with pytest.raises(LlmWikiAgentError):
        ensure_agent(ai)
    with pytest.raises(LlmWikiAgentError):
        remove_agent(ai)


def test_remove_agent_only_removes_managed_profile_and_repairs_active_selection():
    ai, _ = ensure_agent({
        "active_agent_id": "active",
        "agents": [_configured_agent("active"), _configured_agent("backup")],
    })
    ai["active_agent_id"] = LLM_WIKI_AGENT_ID

    updated, changed = remove_agent(ai)

    assert changed is True
    assert all(agent["id"] != LLM_WIKI_AGENT_ID for agent in updated["agents"])
    assert updated["active_agent_id"] == "active"


def test_suspend_agent_preserves_profile_and_reactivation_restores_enabled_state():
    ai, _ = ensure_agent({
        "active_agent_id": "active",
        "agents": [_configured_agent("active")],
    })
    ai["active_agent_id"] = LLM_WIKI_AGENT_ID
    profile = next(
        agent for agent in ai["agents"] if agent["id"] == LLM_WIKI_AGENT_ID
    )
    profile["persona"] = "Custom persona"

    suspended, changed = suspend_agent(ai)
    suspended_profile = next(
        agent
        for agent in suspended["agents"]
        if agent["id"] == LLM_WIKI_AGENT_ID
    )

    assert changed is True
    assert suspended_profile["enabled"] is False
    assert suspended_profile["plugin_suspended"] is True
    assert suspended_profile["persona"] == "Custom persona"
    assert suspended["active_agent_id"] == "active"

    resumed, resumed_changed = ensure_agent(suspended)
    resumed_profile = next(
        agent for agent in resumed["agents"] if agent["id"] == LLM_WIKI_AGENT_ID
    )
    assert resumed_changed is True
    assert resumed_profile["enabled"] is True
    assert resumed_profile["persona"] == "Custom persona"


def test_generic_settings_save_cannot_remove_or_unmanage_the_profile():
    current, _ = ensure_agent({"agents": [_configured_agent("active")]})

    with pytest.raises(LlmWikiAgentError):
        validate_agent_preserved(current, {"agents": [_configured_agent("active")]})

    edited = {"agents": [dict(agent) for agent in current["agents"]]}
    edited["agents"][-1]["persona"] = "Instruccions editades"
    validate_agent_preserved(current, edited)

    edited["agents"][-1].pop("managed_by")
    with pytest.raises(LlmWikiAgentError):
        validate_agent_preserved(current, edited)


def test_lifecycle_requires_confirmation_and_persists_final_plugin_state(monkeypatch):
    """The endpoint must not turn off the feature before the explicit confirm."""
    import asyncio
    from types import SimpleNamespace

    from backend.api import vault_routes as vr
    from backend.scheduler import manager as scheduler_module

    state = {"disabled": [], "settings": {}, "granted": {}}
    transitions = []
    scheduler_updates = []
    monkeypatch.setattr(vr, "_load_plugins_state", lambda: dict(state))
    monkeypatch.setattr(vr, "_save_plugins_state", lambda next_state: state.update(next_state) or dict(state))
    monkeypatch.setattr(
        "backend.services.llm_wiki_agent.transition_agent",
        lambda enabled: transitions.append(enabled) or {"agent_id": LLM_WIKI_AGENT_ID, "agent_changed": True},
    )
    monkeypatch.setattr(vr, "_plugins_mutation_lock", asyncio.Lock())
    monkeypatch.setattr(
        scheduler_module.scheduler_manager,
        "get_task",
        lambda _name: {"interval_minutes": 1440},
    )
    monkeypatch.setattr(
        scheduler_module.scheduler_manager,
        "update_task",
        lambda name, **fields: scheduler_updates.append((name, fields)),
    )
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(agent_cache={"cached": object()})))

    async def scenario():
        with pytest.raises(HTTPException) as generic_error:
            await vr.set_plugins_state(vr.PluginsUpdateRequest(disabled=["llm-wiki"], settings={}))
        assert generic_error.value.status_code == 409

        with pytest.raises(HTTPException) as error:
            await vr.set_llm_wiki_lifecycle(
                vr.LlmWikiLifecycleRequest(enabled=False), request,
            )
        assert error.value.status_code == 409
        assert transitions == []

        result = await vr.set_llm_wiki_lifecycle(
            vr.LlmWikiLifecycleRequest(enabled=False, confirm_disable=True), request,
        )
        assert result["enabled"] is False

    asyncio.run(scenario())
    assert state["disabled"] == ["llm-wiki"]
    assert transitions == [False]
    assert scheduler_updates == [(
        "llm_wiki_maintenance",
        {"interval_minutes": 1440.0, "enabled": False},
    )]
    assert request.app.state.agent_cache == {}


def test_agent_default_never_falls_back_to_an_unrelated_model(monkeypatch):
    """A selected agent either uses its assigned model or remains unavailable."""
    import asyncio

    from backend.agent import factory

    monkeypatch.setattr(
        factory,
        "load_params",
        lambda strict_env=False: {
            "ai": {
                "agents": [{
                    "id": "gnosy",
                    "name": "Gnosy",
                    "provider": "missing",
                    "model": "missing-model",
                    "enabled": True,
                }],
                "providers": {},
            },
        },
    )
    monkeypatch.setattr(factory, "resolve_provider_api_key", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(factory, "get_llm", lambda **_kwargs: None)
    monkeypatch.setattr(
        factory,
        "_get_hybrid_llm",
        lambda: (_ for _ in ()).throw(AssertionError("agent_default must not fall back")),
    )

    workflow, selection = asyncio.run(
        factory.create_agent_workflow([], object(), agent_id="gnosy"),
    )

    assert workflow is None
    assert selection == {
        "mode": "agent_default",
        "provider": "missing",
        "model": "missing-model",
    }
