"""Contextual reading freezes the principal and executes each phase centrally."""
from types import SimpleNamespace
import json
from unittest.mock import Mock
import pytest

from backend.domains.llm_wiki.reading_skill import INSTRUCTIONS, SKILL_ID
from backend.services.llm_wiki_reading_runtime import prepare_reading_runtime
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_execution_scope import execution_scope


@pytest.fixture
def configured(monkeypatch, tmp_path):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
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


def test_large_model_retains_its_full_context_capacity(configured, tmp_path, monkeypatch):
    _, _, execute = configured
    monkeypatch.setattr("backend.domains.agent.runtime_tools._model_context_window", lambda *_: 1_048_576)
    runtime = prepare_reading_runtime(tmp_path)
    prompt = "Evidence from a long source. " * 13_000
    assert runtime.input_budget > 700_000
    runtime.generate_structured(prompt, lambda _: None, 900)
    assert execute.call_args.args[0].input == prompt
    assert execute.call_args.args[0].timeout_seconds == 900


def test_structured_prompt_obeys_the_same_budget(configured, tmp_path):
    _, _, execute = configured
    runtime = prepare_reading_runtime(tmp_path)
    with pytest.raises(RuntimeError, match="context budget"):
        runtime.generate_structured("x" * (runtime.input_budget + 1), lambda _: None, 240)
    execute.assert_not_called()


@pytest.mark.parametrize("structured", [False, True])
def test_escaped_source_is_budgeted_after_operation_wrapping(configured, tmp_path, structured):
    _, _, execute = configured
    runtime = prepare_reading_runtime(tmp_path)
    # Source quotes and backslashes expand twice: in the operation input and
    # in the message serialization used by the central context guard.
    prompt = json.dumps({"source": '\\"\n' * 2_000})
    assert len(prompt.encode("utf-8")) < runtime.input_budget
    with pytest.raises(RuntimeError, match="context budget"):
        if structured:
            runtime.generate_structured(prompt, lambda _: None, 240)
        else:
            runtime.generate(prompt)
    execute.assert_not_called()


def test_reading_budget_matches_the_central_serialized_message_guard(configured, tmp_path):
    from langchain_core.messages import HumanMessage, SystemMessage
    from backend.services.agent_behavior import operation_input
    from backend.services.agent_context_budget import messages_budget

    _, _, execute = configured
    runtime = prepare_reading_runtime(tmp_path)
    schema = {"type": "object", "properties": {"summary": {"type": "string"}}}
    prompt = json.dumps({"source": '\\"\n' * 200, "output_schema": schema})
    assert runtime.count_tokens(prompt) <= runtime.input_budget
    runtime.generate_structured(prompt, lambda _: None, 240)
    request = execute.call_args.args[0]
    measured = messages_budget(
        [SystemMessage(content=runtime.instructions), HumanMessage(content=operation_input(request))],
        "fixture", 32_768,
    )
    assert measured["fits"]
    assert runtime.count_tokens(prompt) > len(prompt.encode("utf-8"))


def test_directed_reading_sends_the_action_schema_to_the_operation(configured, tmp_path):
    from backend.domains.llm_wiki.directed_reading import ACTION_SCHEMA
    _, _, execute = configured
    runtime = prepare_reading_runtime(tmp_path)
    prompt = json.dumps({"phase": "agent-actions", "output_schema": ACTION_SCHEMA})
    runtime.generate_structured(prompt, lambda _: None, 900)
    request = execute.call_args.args[0]
    assert request.output_schema == ACTION_SCHEMA
    assert request.input == prompt
    assert request.max_model_calls == 3


def test_prose_argument_map_stays_governed_without_a_json_output_schema(configured, tmp_path):
    _, _, execute = configured
    runtime = prepare_reading_runtime(tmp_path)
    validator = lambda text: text.strip()
    runtime.generate_prose('{"phase":"overview","material":"source"}', validator, 240)
    request = execute.call_args.args[0]
    assert request.operation == 'knowledge.process-source.phase'
    assert request.output_schema is None and request.max_model_calls == 2
    assert request.resume_requires_parent and request.timeout_seconds == 240
    assert execute.call_args.kwargs['output_validator'] is validator
    assert execute.call_args.kwargs['snapshot'].agent_id == runtime.agent_id
    execute.reset_mock()
    with pytest.raises(RuntimeError, match='context budget'):
        runtime.generate_prose('x' * (runtime.input_budget + 1), validator, 240)
    execute.assert_not_called()


def test_bounded_map_reduction_does_not_repeat_sources_for_generic_format_repair(configured, tmp_path):
    _, _, execute = configured
    runtime = prepare_reading_runtime(tmp_path)
    runtime.generate_prose(json.dumps({'map_contract': 'bounded-reduction-v1', 'material': ['Complete maps']}), str.strip, 240)
    request = execute.call_args.args[0]
    assert request.max_model_calls == 1
    assert request.output_schema is None and request.options['reading_prose']
    assert request.resume_requires_parent and execute.call_args.kwargs['snapshot'] == runtime.snapshot
