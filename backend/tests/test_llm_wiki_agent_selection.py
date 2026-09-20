"""Agent selection, editable instructions, and migration without live AI calls."""

import asyncio
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from backend.services import llm_wiki_agent, llm_wiki_config, llm_wiki_generation
from backend.services.llm_wiki_agent import LlmWikiAgentError, ensure_agent, suspend_agent


def profile(**values):
    return {"id": "custom", "name": "Custom", "provider": "test", "model": "chosen",
            "enabled": True, "persona": "My persona", "context": "My context",
            "skill_ids": ["user.ingest"], **values}


@pytest.mark.parametrize("legacy", [False, True])
def test_config_defaults_and_explicit_selection_survives_disk(tmp_path, monkeypatch, legacy):
    ai = {"active_agent_id": "principal", "agents": [profile(id="principal")]}
    if legacy:
        ai, _ = ensure_agent(ai)
    monkeypatch.setattr(llm_wiki_agent, "load_params", lambda **_: SimpleNamespace(ai=ai))
    monkeypatch.setattr(llm_wiki_config, "config_path", lambda: tmp_path / "wiki.json")
    monkeypatch.setattr(llm_wiki_config, "_legacy_reference_table_id", lambda: "")
    assert llm_wiki_config.normalize_config({})["agent_id"] == ""
    expected = "llm-wiki" if legacy else "principal"
    assert llm_wiki_config.load_config()["agent_id"] == expected
    assert llm_wiki_config.migrate_config()["agent_id"] == expected
    ai["active_agent_id"] = "different-principal"
    assert llm_wiki_config.load_config()["agent_id"] == expected
    llm_wiki_config.save_config({"agent_id": "custom", "brain_table_id": "brain"})
    assert llm_wiki_config.migrate_config()["agent_id"] == "custom"


@pytest.mark.parametrize("selection", ["custom", "missing", "llm-wiki"])
def test_explicit_selections_never_resolve_to_the_principal(monkeypatch, selection):
    monkeypatch.setattr(llm_wiki_config, "load_config", lambda: {"agent_id": selection})
    default = Mock(return_value="principal")
    monkeypatch.setattr(llm_wiki_generation, "default_plugin_agent_id", default)
    assert llm_wiki_generation.configured_agent_id() == selection
    default.assert_not_called()


def test_lifecycle_unlocks_query_and_preserves_custom_or_empty_skills():
    for skills in (["user.query"], []):
        ai = {"agents": [profile(id="llm-wiki", managed_by="llm-wiki",
                                skill_ids=skills, required_skill_ids=["plugin.llm-wiki.query"])]}
        updated, changed = ensure_agent(ai)
        assert changed
        assert updated["agents"][0]["required_skill_ids"] == []
        suspended, _ = suspend_agent(updated)
        resumed, _ = ensure_agent(suspended)
        assert resumed["agents"][0]["skill_ids"] == skills
        assert resumed["agents"][0]["persona"] == "My persona"


def test_reactivation_does_not_reassign_a_removed_default_skill():
    from backend.services.llm_wiki_agent import LEGACY_LLM_WIKI_SKILL_IDS

    created, _ = ensure_agent({"agents": [profile()]})
    created["agents"][-1]["skill_ids"] = LEGACY_LLM_WIKI_SKILL_IDS
    suspended, _ = suspend_agent(created)
    resumed, _ = ensure_agent(suspended)
    assert resumed["agents"][-1]["skill_ids"] == LEGACY_LLM_WIKI_SKILL_IDS


def test_select_agent_without_tables_preserves_other_config_and_validates_before_write(tmp_path, monkeypatch):
    from backend.domains.configuration.llm_wiki import put_config

    monkeypatch.setattr(llm_wiki_config, "config_path", lambda: tmp_path / "wiki.json")
    monkeypatch.setattr(llm_wiki_config, "_legacy_reference_table_id", lambda: "")
    monkeypatch.setattr(llm_wiki_generation, "agent_profiles", lambda: [profile()])
    llm_wiki_config.save_config({"ui_locale": "ca"})
    dependencies = SimpleNamespace(config_response=lambda config: {"config": config})
    result = asyncio.run(put_config({"agent_id": "custom"}, dependencies))
    assert result["config"]["agent_id"] == "custom"
    assert result["config"]["ui_locale"] == "ca"
    assert result["config"]["source_tables"] == []
    before = (tmp_path / "wiki.json").read_bytes()
    with pytest.raises(HTTPException) as error:
        asyncio.run(put_config({"agent_id": "missing"}, dependencies))
    assert error.value.status_code == 400
    assert (tmp_path / "wiki.json").read_bytes() == before


def test_generation_reads_selected_profile_and_current_custom_skill_content(monkeypatch):
    from backend.agent import factory
    from backend.models.agent_skills import SkillActivation, SkillKind
    from backend.services import agent_skill_catalog

    monkeypatch.setattr(llm_wiki_config, "load_config", lambda: {"agent_id": "custom"})
    monkeypatch.setattr(llm_wiki_generation, "agent_profiles", lambda: [profile()])
    skill = SimpleNamespace(id="user.ingest", kind=SkillKind.AGENT,
                            activation=SkillActivation.EXPLICIT,
                            tool_ids=["plugin.llm-wiki.process-source"], instructions="Edited instructions")
    entry = SimpleNamespace(available=True, descriptor=skill)
    monkeypatch.setattr(agent_skill_catalog, "get_skill_catalog",
                        lambda: SimpleNamespace(list_entries=lambda: [entry]))
    generate = Mock(return_value=("result", "chosen"))
    monkeypatch.setattr(factory, "generate_text", generate)
    assert llm_wiki_generation.generate_text("JSON contract", operation="plugin.llm-wiki.process-source") == ("result", "chosen")
    assert generate.call_args.args == ("JSON contract",)
    assert generate.call_args.kwargs["agent_id"] == "custom"
    assert generate.call_args.kwargs["system_prompt"] == "My persona\n\nMy context\n\nEdited instructions"
    skill.instructions = "New content"
    llm_wiki_generation.generate_text("JSON contract", operation="plugin.llm-wiki.process-source")
    assert "New content" in generate.call_args.kwargs["system_prompt"]
    entry.available = False
    llm_wiki_generation.generate_text("JSON contract", operation="plugin.llm-wiki.process-source")
    assert "New content" not in generate.call_args.kwargs["system_prompt"]


@pytest.mark.parametrize("agents", [[], [profile(enabled=False)], [profile(model="")], [profile(plugin_suspended=True)]])
def test_unavailable_selected_agent_never_calls_model(monkeypatch, agents):
    from backend.agent import factory

    monkeypatch.setattr(llm_wiki_generation, "agent_profiles", lambda: agents)
    generate = Mock()
    monkeypatch.setattr(factory, "generate_text", generate)
    with pytest.raises(LlmWikiAgentError):
        llm_wiki_generation.generate_text("prompt", agent_id="custom")
    generate.assert_not_called()


def test_explicit_model_selection_does_not_fall_back(monkeypatch):
    from backend.domains.agent import llm

    monkeypatch.setattr(llm, "load_params", lambda **_: SimpleNamespace(ai={
        "agents": [profile()], "providers": {}, "active_agent_id": "other",
    }))
    monkeypatch.setattr(llm, "resolve_provider_api_key", lambda *_: None)
    model = Mock(return_value=None)
    fallback = Mock()
    monkeypatch.setattr(llm, "get_llm", model)
    monkeypatch.setattr(llm, "_get_hybrid_llm", fallback)
    assert llm.get_default_llm_with_meta(agent_id="missing") == (None, None, None)
    model.assert_not_called()
    assert llm.get_default_llm_with_meta(agent_id="custom") == (None, None, None)
    assert model.call_args.kwargs["model"] == "chosen"
    fallback.assert_not_called()
