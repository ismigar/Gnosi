"""Contextual reading freezes the principal and executes each phase centrally."""
from types import SimpleNamespace
from unittest.mock import Mock
import pytest

from backend.domains.llm_wiki.reading_skill import INSTRUCTIONS, SKILL_ID
from backend.services.llm_wiki_reading_runtime import prepare_reading_runtime
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_execution_scope import execution_scope


@pytest.fixture
def configured(monkeypatch, tmp_path):
    principal = {"id": "builtin.llm-wiki.default", "managed_by": "builtin:llm-wiki", "enabled": True, "provider": "openai", "model": "fixture",
                 "persona": "Personal reading style", "context": "Research context", "skill_ids": [SKILL_ID]}
    ai = {"agents": [principal, {"id": "personal", "model": "different"}], "active_agent_id": "personal", "providers": {"openai": {"enabled": True}}}
    monkeypatch.setattr("backend.services.principal_agent_migration.ensure_migrated", lambda: ai)
    monkeypatch.setattr("backend.services.plugin_ai_contributions.reconcile_plugin_ai_contributions", lambda: {})
    resolve = Mock(return_value=SimpleNamespace(active_skill_ids=(SKILL_ID,), instructions=(INSTRUCTIONS,), catalog_revision="test"))
    monkeypatch.setattr("backend.services.agent_skill_catalog.resolve_agent_runtime", resolve)
    monkeypatch.setattr("backend.domains.agent.runtime_tools._model_context_window", lambda *_: 32768)
    execute = Mock(return_value=SimpleNamespace(result='{"summary":"map"}', model="fixture"))
    monkeypatch.setattr("backend.services.agent_execution.run_sync", execute)
    with execution_scope(ExecutionScope(user_id="alice",workspace_id="personal",vault_path=str(tmp_path),role="owner")):
        yield ai, resolve, execute


@pytest.mark.parametrize("legacy", [False, True])
def test_same_plugin_profile_and_skill_are_frozen_across_all_phases(configured, tmp_path, legacy):
    ai, resolve, execute = configured
    if legacy:
        ai["agents"].append({**ai["agents"][0], "id": "llm-wiki", "managed_by": "llm-wiki"})
    runtime = prepare_reading_runtime(tmp_path)
    assert runtime.agent_id == "builtin.llm-wiki.default"
    original = runtime.identity
    ai["agents"][0]["model"] = "changed-after-start"
    for phase in ("overview", "extract", "review"):
        runtime.generate(phase, timeout=45)
    assert runtime.identity == original
    assert execute.call_count == 3
    snapshot = execute.call_args.kwargs["snapshot"]
    assert snapshot.profile["model"] == "fixture"
    assert snapshot.instructions == [INSTRUCTIONS]
    assert "Personal reading style" in runtime.instructions
    assert "Research context" in runtime.instructions
    assert runtime.metadata["skill_id"] == SKILL_ID
    assert execute.call_args.args[0].timeout_seconds == 45


def test_missing_skill_is_not_silently_granted(configured, tmp_path):
    _, resolve, execute = configured
    resolve.return_value = SimpleNamespace(active_skill_ids=(), instructions=(), catalog_revision="test")
    with pytest.raises(RuntimeError, match="agent_skill_unavailable"):
        prepare_reading_runtime(tmp_path)
    execute.assert_not_called()


def test_disabled_profile_does_not_fall_back_to_another_agent(configured, tmp_path):
    ai, _, execute = configured
    ai["agents"][0]["enabled"] = False
    ai["agents"].append({"id":"other", "enabled":True})
    with pytest.raises(RuntimeError, match="plugin_profile_unavailable"):
        prepare_reading_runtime(tmp_path)
    execute.assert_not_called()


def test_changed_skill_changes_checkpoint_identity(configured, tmp_path):
    _, resolve, _ = configured
    first = prepare_reading_runtime(tmp_path)
    resolve.return_value.instructions = (INSTRUCTIONS + "\nPreserve disputed definitions.",)
    assert first.identity != prepare_reading_runtime(tmp_path).identity


def test_oversized_prompt_never_reaches_provider(configured, tmp_path):
    _, _, execute = configured
    runtime = prepare_reading_runtime(tmp_path)
    with pytest.raises(RuntimeError, match="context budget"):
        runtime.generate("x" * (runtime.input_budget + 1))
    execute.assert_not_called()
