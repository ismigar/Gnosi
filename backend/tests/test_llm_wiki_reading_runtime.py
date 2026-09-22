"""The button and chat worker share one frozen, governed agent and skill."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from langchain_core.messages import AIMessage

from backend.domains.llm_wiki.reading_skill import INSTRUCTIONS, SKILL_ID
from backend.services.llm_wiki_reading_runtime import prepare_reading_runtime


@pytest.fixture
def configured(monkeypatch):
    from backend.agent import (
        factory as _factory,
    )  # Load compatibility modules before replacing config.

    principal = {
        "id": "principal",
        "enabled": True,
        "provider": "openai",
        "model": "fixture",
        "persona": "Personal reading style",
        "context": "Research context",
        "skill_ids": [SKILL_ID],
    }
    ai = {
        "agents": [principal],
        "active_agent_id": "principal",
        "providers": {"openai": {"enabled": True}},
    }
    monkeypatch.setattr("backend.config.app_config.load_params", lambda **_: SimpleNamespace(ai=ai))
    monkeypatch.setattr("backend.services.llm_wiki_config.load_config", lambda: {})
    resolve = Mock(
        return_value=SimpleNamespace(active_skill_ids=(SKILL_ID,), instructions=(INSTRUCTIONS,))
    )
    monkeypatch.setattr("backend.services.agent_skill_catalog.resolve_agent_runtime", resolve)
    monkeypatch.setattr(
        "backend.domains.agent.runtime_tools._model_context_window", lambda *_: 32768
    )
    monkeypatch.setattr(
        "backend.security.ai_credentials.resolve_provider_api_key", lambda *_: "fixture-key"
    )
    client = Mock()
    client.invoke.return_value = AIMessage(content='{"summary":"map"}')
    llm_factory_mock = Mock(return_value=client)
    monkeypatch.setattr("backend.agent.factory.get_llm", llm_factory_mock)
    monkeypatch.setattr("backend.agent.model_router.record_llm_usage", Mock())
    return ai, resolve, llm_factory_mock, client


@pytest.mark.parametrize("legacy", [False, True])
def test_same_profile_and_skill_are_frozen_across_all_phases(configured, tmp_path, legacy):
    ai, resolve, llm_factory_mock, client = configured
    if legacy:
        ai["agents"].append({**ai["agents"][0], "id": "llm-wiki", "managed_by": "llm-wiki"})
    runtime = prepare_reading_runtime(tmp_path)
    assert runtime.agent_id == ("llm-wiki" if legacy else "principal")
    assert resolve.call_args.kwargs["active_skill_ids"] == [SKILL_ID]
    original = runtime.identity
    ai["agents"][0]["model"] = "changed-after-start"
    for phase in ("overview", "extract", "review"):
        runtime.generate(phase, timeout=45)
    assert runtime.identity == original
    assert llm_factory_mock.call_args.kwargs["model"] == "fixture"
    assert llm_factory_mock.call_args.kwargs["timeout"] == 45
    system = client.invoke.call_args.args[0][0].content
    assert (
        INSTRUCTIONS in system
        and "Personal reading style" in system
        and "Research context" in system
    )
    assert runtime.metadata["skill_id"] == SKILL_ID
    assert "fixture-key" not in str(runtime.metadata)


def test_missing_skill_is_not_silently_granted(configured, tmp_path):
    _, resolve, llm_factory_mock, _ = configured
    resolve.return_value = SimpleNamespace(active_skill_ids=(), instructions=())
    with pytest.raises(RuntimeError, match="Assign the Process Brain source skill"):
        prepare_reading_runtime(tmp_path)
    llm_factory_mock.assert_not_called()


def test_disabled_profile_does_not_fall_back_to_another_agent(configured, tmp_path):
    ai, _, llm_factory_mock, _ = configured
    ai["agents"][0]["enabled"] = False
    with pytest.raises(RuntimeError, match="Enable the Brain processing agent"):
        prepare_reading_runtime(tmp_path)
    llm_factory_mock.assert_not_called()


def test_changed_skill_changes_checkpoint_identity(configured, tmp_path):
    _, resolve, _, _ = configured
    first = prepare_reading_runtime(tmp_path)
    resolve.return_value.instructions = (INSTRUCTIONS + "\nPreserve disputed definitions.",)
    second = prepare_reading_runtime(tmp_path)
    assert first.identity != second.identity


def test_oversized_prompt_never_reaches_provider(configured, tmp_path):
    _, _, _, client = configured
    runtime = prepare_reading_runtime(tmp_path)
    with pytest.raises(RuntimeError, match="context budget"):
        runtime.generate("x" * (runtime.input_budget + 1))
    client.invoke.assert_not_called()


def test_explicit_brain_profile_overrides_legacy_and_principal(configured, tmp_path, monkeypatch):
    ai, resolve, llm_factory_mock, _ = configured
    ai["agents"].extend([
        {**ai["agents"][0], "id": "llm-wiki", "managed_by": "llm-wiki"},
        {**ai["agents"][0], "id": "custom", "model": "chosen"},
    ])
    monkeypatch.setattr("backend.services.llm_wiki_config.load_config",
                        lambda: {"agent_id": "custom"})
    runtime = prepare_reading_runtime(tmp_path)
    assert runtime.agent_id == "custom"
    assert resolve.call_args.args[0]["id"] == "custom"
    assert llm_factory_mock.call_args.kwargs["model"] == "chosen"


@pytest.mark.parametrize("selection", ["missing", "suspended"])
def test_unavailable_explicit_profile_never_falls_back(configured, tmp_path, monkeypatch, selection):
    ai, _, llm_factory_mock, _ = configured
    ai["agents"].append({**ai["agents"][0], "id": "suspended", "plugin_suspended": True})
    monkeypatch.setattr("backend.services.llm_wiki_config.load_config",
                        lambda: {"agent_id": selection})
    with pytest.raises(RuntimeError, match="Enable the Brain processing agent"):
        prepare_reading_runtime(tmp_path)
    llm_factory_mock.assert_not_called()
