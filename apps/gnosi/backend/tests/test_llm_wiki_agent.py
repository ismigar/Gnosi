"""Unit tests for the protected LLM Wiki agent lifecycle."""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.services.llm_wiki_agent import (
    LLM_WIKI_AGENT_ID,
    LLM_WIKI_AGENT_MARKER,
    LlmWikiAgentError,
    ensure_agent,
    remove_agent,
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

    profile["persona"] = "Instruccions personals"
    repeated, changed = ensure_agent(created)
    assert changed is False
    assert next(agent for agent in repeated["agents"] if agent["id"] == LLM_WIKI_AGENT_ID)["persona"] == "Instruccions personals"


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


def test_agent_startup_unpacks_hybrid_fallback_metadata(monkeypatch):
    """The managed profile can fall back without binding tools to a tuple."""
    import asyncio

    from backend.agent import factory

    class FakeLlm:
        def bind_tools(self, _tools):
            return self

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
        lambda: (FakeLlm(), "openai", "fallback-model"),
    )
    monkeypatch.setattr(factory, "get_mcp_tools", lambda *_args: [])
    monkeypatch.setattr(factory.tool_loader, "load_all_approved", lambda: [])

    workflow, selection = asyncio.run(
        factory.create_agent_workflow([], object(), agent_id="gnosy"),
    )

    assert workflow is not None
    assert selection["provider"] == "openai"
    assert selection["model"] == "fallback-model"
