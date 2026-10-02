"""Operations consult assigned read tools before returning typed field values."""

import asyncio
from dataclasses import dataclass
from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import tool

from backend.domains.agent import operation_graph
from backend.models.agent_skills import ToolDescriptor
from backend.services import agent_execution as execution
from backend.services.agent_execution_models import AgentOperation
from backend.services.agent_execution_scope import execution_scope
from backend.tests.test_agent_execution import runtime  # noqa: F401


@pytest.fixture
def reading(runtime, monkeypatch):
    scope, snapshot = runtime
    from backend.agent import model_router
    monkeypatch.setattr(model_router, "budget_status", lambda: {"over_cap": False})
    calls, bindings = [], []
    @tool
    def count_sources(topic: str) -> int:
        """Count sources for a topic in the active vault."""
        calls.append(topic)
        return 7
    descriptor = ToolDescriptor(id="user.count-sources", name="Translated display name", origin={"type": "user", "id": "qa"},
        input_schema={"type": "object", "properties": {"topic": {"type": "string"}},
                      "required": ["topic"], "additionalProperties": False})
    @dataclass
    class Capabilities:
        active_skill_ids: tuple = tuple(snapshot.skill_ids)
        instructions: tuple = tuple(snapshot.instructions)
        catalog_revision: str = "1"
        tools: tuple = (count_sources,)
        tool_descriptors: tuple = (descriptor,)
    capabilities = Capabilities()
    from backend.services import agent_skill_catalog
    monkeypatch.setattr(agent_skill_catalog, "resolve_agent_runtime", lambda *_args, **_kwargs: capabilities)
    class Model:
        model_name = "fixture"
        def bind_tools(self, values, **kwargs):
            bindings.append(values)
            return self
    from backend.agent import factory
    async def create(*_args, **kwargs):
        graph = operation_graph.operation_workflow(Model(), "Use the source counter", 32000,
            runtime=kwargs["runtime_capabilities"] if kwargs["operation_read_tools"] else None)
        return graph, {"model": "fixture", "provider": "test"}
    monkeypatch.setattr(factory, "create_agent_workflow", create)
    def model(_model, messages, _state):
        execution.before_model_call()
        if isinstance(messages[-1], ToolMessage):
            return AIMessage(content='{"value":' + messages[-1].content + '}')
        return AIMessage(content="", tool_calls=[{"name": "count_sources", "args": {"topic": "dreams"}, "id": "call"}])
    monkeypatch.setattr(operation_graph, "_invoke_agent_model", model)
    request = AgentOperation(skill_id=snapshot.skill_ids[0], operation="tables.skill-fields", tool_mode="read",
        max_model_calls=3, output_schema={"type": "object", "properties": {"value": {"type": "integer"}},
                                         "required": ["value"], "additionalProperties": False})
    return scope, snapshot, capabilities, descriptor, calls, bindings, request


def run(reading):
    scope, snapshot, *_rest, request = reading
    with execution_scope(scope):
        return asyncio.run(execution.execute_operation(request, snapshot=snapshot))


def test_operation_reads_actual_tool_result_then_returns_valid_json(reading, monkeypatch):
    from backend.domains.agent import policy
    from backend.agent.action_confirmations import current_confirmation_scope
    audits = []
    monkeypatch.setattr(policy, "record_capability_event", lambda scope, **event: audits.append((scope, event)))
    result = run(reading)
    assert result.status == "completed" and result.result == '{"value": 7}'
    assert result.model_calls == 2 and reading[4] == ["dreams"]
    assert reading[5][0][0].name == "count_sources"
    assert len(audits) == 1 and audits[0][1]["tool_id"] == "user.count-sources"
    assert audits[0][0]["session_id"] == result.run_id
    assert audits[0][0]["user_id"] == reading[0].user_id
    with pytest.raises(RuntimeError): current_confirmation_scope()


@pytest.mark.parametrize("effects", [["local_write"], ["read", "external_write"], ["code_execution"], ["data_egress"]])
def test_mutating_tools_are_never_bound_or_executed(reading, effects):
    capabilities, descriptor = reading[2:4]
    capabilities.tool_descriptors = (descriptor.model_copy(update={"effects": effects}),)
    with pytest.raises(PermissionError, match="unassigned"):
        run(reading)
    assert not reading[4] and not reading[5]


def test_role_is_checked_before_tool_execution(reading):
    reading[2].tool_descriptors = (reading[3].model_copy(update={"minimum_role": "owner"}),)
    # The role comes from the frozen execution scope, not generated tool arguments.
    scope = reading[0].model_copy(update={"role": "viewer"})
    snapshot = reading[1].model_copy(update={"scope": scope})
    with execution_scope(scope), pytest.raises(RuntimeError, match="agent_operation_tool_failed"):
        asyncio.run(execution.execute_operation(reading[-1], snapshot=snapshot))
    assert not reading[4]


def test_effect_changed_after_binding_is_rejected_before_execution(reading, monkeypatch):
    original = operation_graph._invoke_agent_model
    def changed(*args):
        result = original(*args)
        reading[2].tool_descriptors = (reading[3].model_copy(update={"effects": ["local_write"]}),)
        return result
    monkeypatch.setattr(operation_graph, "_invoke_agent_model", changed)
    with pytest.raises(PermissionError, match="effect_changed"):
        run(reading)
    assert not reading[4]


def test_repeated_tool_rounds_stop_at_model_budget(reading, monkeypatch):
    def repeating(_model, _messages, _state):
        execution.before_model_call()
        return AIMessage(content="", tool_calls=[{"name": "count_sources", "args": {"topic": "dreams"}, "id": "call"}])
    monkeypatch.setattr(operation_graph, "_invoke_agent_model", repeating)
    with pytest.raises(RuntimeError, match="agent_operation_call_budget_exceeded"):
        run(reading)
    assert len(reading[4]) == 3


def test_tool_revoked_after_model_selection_cannot_execute(reading, monkeypatch):
    original = operation_graph._invoke_agent_model
    def revoked(*args):
        result = original(*args)
        reading[2].tools = ()
        reading[2].tool_descriptors = ()
        return result
    monkeypatch.setattr(operation_graph, "_invoke_agent_model", revoked)
    with pytest.raises(PermissionError, match="tool_revoked"):
        run(reading)
    assert not reading[4]


def test_invalid_tool_arguments_abort_instead_of_becoming_generated_fields(reading, monkeypatch):
    def invalid(_model, _messages, _state):
        execution.before_model_call()
        return AIMessage(content="", tool_calls=[{"name": "count_sources", "args": {"topic": 7}, "id": "call"}])
    monkeypatch.setattr(operation_graph, "_invoke_agent_model", invalid)
    with pytest.raises(RuntimeError, match="agent_operation_tool_failed"):
        run(reading)
    assert not reading[4]


def test_cancelled_run_does_not_execute_selected_tool(reading, monkeypatch):
    from backend.services import agent_execution_store as store
    from backend.services.agent_cancellation import AgentTurnCancelled
    original = operation_graph._invoke_agent_model
    def cancelled(*args):
        result = original(*args)
        store.cancel(reading[0], execution._run.get())
        return result
    monkeypatch.setattr(operation_graph, "_invoke_agent_model", cancelled)
    with pytest.raises(AgentTurnCancelled):
        run(reading)
    assert not reading[4]
    assert store.list_runs(reading[0])[0].status == "cancelled"


def test_format_repair_keeps_read_evidence_without_repeating_tools(reading, monkeypatch):
    def answer(_model, messages, _state):
        execution.before_model_call()
        if isinstance(messages[-1], ToolMessage):
            return AIMessage(content='The number is seven: {"value": 7}')
        if any(isinstance(message, ToolMessage) for message in messages):
            assert any(getattr(message, "tool_calls", None) for message in messages)
            return AIMessage(content='{"value":7}')
        return AIMessage(content="", tool_calls=[{"name": "count_sources", "args": {"topic": "dreams"}, "id": "call"}])
    monkeypatch.setattr(operation_graph, "_invoke_agent_model", answer)
    result = run(reading)
    assert result.status == "completed" and result.model_calls == 3
    assert result.result == '{"value": 7}' and reading[4] == ["dreams"]
    assert len(reading[5]) == 1
