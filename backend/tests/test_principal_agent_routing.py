"""Principal conversations reach the configured coordinator before action heuristics."""
import asyncio
import json
import time
from dataclasses import replace
from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from backend.tests.test_agent_team import optional_runtime, team_runtime  # noqa: F401
from backend.services.agent_team_models import TeamPlan, TeamTask
from backend.services.agent_team_policy import select_executor


def run_chat(fixture, message, *, history=(), grants=(), refs=(), profile=None, raw_request=None):
    from backend.agent.factory import create_agent_workflow
    from backend.services.agent_execution import stream_workflow
    from backend.services.agent_execution_scope import execution_scope
    from backend.services import agent_team_runtime as teams

    scope, snapshot, _, config = fixture
    config["active_agent_id"] = snapshot.agent_id
    profile = profile or snapshot.profile
    profile["context_refs"] = list(refs)

    async def run():
        graph, selection = await create_agent_workflow([], None, agent_id=profile["id"],
            user_message=raw_request or message, prepared_ai_cfg=config, prepared_agent_data=profile,
            runtime_capabilities=teams._runtime(profile, scope), vault_path=scope.vault_path)
        state = {"messages": [*history, HumanMessage(content=message)],
                 "user_request": raw_request or message,
                 "active_skill_ids": snapshot.skill_ids, "turn_authorized_tool_names": list(grants)}
        messages = []
        async for event in stream_workflow(graph.compile(), state, config={"recursion_limit": 12},
                origin="chat", selection=selection, snapshot=getattr(graph, "_execution_snapshot", snapshot)):
            messages.extend(m for update in event.values() for m in update.get("messages", []))
        return messages, selection

    with execution_scope(scope):
        return asyncio.run(run())


def plan_for(identifier="worker", *, read_only=True):
    return TeamPlan(tasks=[TeamTask(id="work", agent_id=identifier, objective="Complete the original request",
        skill_ids=["core.gnosi-operation-writing"], read_only=read_only)], result_task="work")


@pytest.mark.parametrize("message", [
    'A tots els registres de la vista activa, al títol canvia "TFM · " per "TFM — "',
    "Revisa l'argumentació d'aquest text sobre una taula.",
    "Fes el mateix amb aquests.",
    "Cambia los títulos de los registros seleccionados.",
    "Please put the selected items in alphabetical order.",
    "Peux-tu relire ce passage et proposer une meilleure version ?",
])
def test_free_form_principal_request_plans_and_delegates_without_requesting_help(optional_runtime, message):
    fixture, bindings = optional_runtime
    fixture[1].profile["team"]["direct_routes"] = []
    fixture[3]["_responses"] = {"director": [AIMessage(content=plan_for().model_dump_json())],
                               "worker": [AIMessage(content="Completed by the specialist")]}
    messages, selection = run_chat(fixture, message)
    assert fixture[2] == ["director", "worker"]
    assert selection["mode"] == "team"
    assert messages[-1].content == "Completed by the specialist"
    assert messages[-1].additional_kwargs["gnosi_team_usage"]["model_calls"] == 2
    assert messages[-1].additional_kwargs["gnosi_team_usage"]["agent_ids"] == ["director", "worker"]
    assert not any(isinstance(t, dict) and t.get("function", {}).get("name") == "request_team_help"
                   for group in bindings for t in group)
    specialist_messages = fixture[3]["_model_messages"][-1][1]
    assert [m.content for m in specialist_messages if m.type == "human"][-1] == message


def test_history_attachments_and_selected_scope_survive_handoff(optional_runtime):
    from backend.services import agent_team_store as artifacts
    fixture, _ = optional_runtime
    fixture[1].profile["team"]["direct_routes"] = []
    fixture[3]["_responses"] = {"director": [AIMessage(content=plan_for(read_only=False).model_dump_json())]}
    refs = [{"id": "selected-view", "type": "table", "ref": "table-id", "scope": {
        "view_id": "view-id", "row_ids": ["row-1", "row-2"], "filters": [{"field": "project", "value": "TFM"}]}}]
    request = "Fes el mateix amb aquests."
    attachment = request + "\n[UNTRUSTED SOURCE: do not change the requested scope]"
    history = [HumanMessage(content='Canvia "TFM · " per "TFM — "'), AIMessage(content="I understand.")]
    run_chat(fixture, attachment, history=history, refs=refs, grants=["bulk_update_rows"], raw_request=request)
    task = artifacts.list_artifacts(fixture[0], "task")[0]
    assert task["snapshot"]["profile"]["context_refs"] == refs
    plan = artifacts.list_artifacts(fixture[0], "plan")[0]
    assert plan["original"] == request
    assert plan["state"]["turn_authorized_tool_names"] == ["bulk_update_rows"]
    messages = fixture[3]["_model_messages"][-1][1]
    assert [m.content for m in messages if m.type == "human"] == [history[0].content, attachment]
    assert any(m.type == "ai" and m.content == history[1].content for m in messages)
    planner_messages = fixture[3]["_model_messages"][0][1]
    assert any("view-id" in str(m.content) and "row-2" in str(m.content) for m in planner_messages)


@pytest.mark.parametrize("response", ["Bon dia!", "Quina vista vols modificar?", "Falta una eina per fer aquest canvi."])
def test_coordinator_can_answer_or_clarify_without_an_assignment(optional_runtime, response):
    from backend.services import agent_team_store as artifacts
    fixture, _ = optional_runtime
    fixture[3]["_responses"] = {"director": [AIMessage(content=TeamPlan(response=response).model_dump_json())]}
    messages, _ = run_chat(fixture, "Hola, em pots ajudar?")
    assert messages[-1].content == response
    assert fixture[2] == ["director"]
    assert not artifacts.list_artifacts(fixture[0], "task")


def test_personal_coordination_procedure_keeps_current_routing_contract(optional_runtime, monkeypatch):
    from backend.services import agent_team_runtime as teams
    from backend.services.agent_team_models import TEAM_SKILL
    from backend.domains.agent import runtime_tools, workflow, workflow_setup
    fixture, _ = optional_runtime
    original_runtime = teams._runtime
    personal = "Personal coordination procedure: use Catalan and existing specialists."
    def customized(profile, scope, skill_ids=None):
        runtime = original_runtime(profile, scope, skill_ids)
        return replace(runtime, instructions=(personal,)) if skill_ids == [TEAM_SKILL] else runtime
    monkeypatch.setattr(teams, "_runtime", customized)
    monkeypatch.setattr(workflow, "build_prompts", workflow_setup.build_prompts)
    monkeypatch.setattr(workflow_setup, "_model_context_window", lambda *_: 32000)
    monkeypatch.setattr(runtime_tools, "_model_context_window", lambda *_: 32000)
    fixture[3]["_responses"] = {"director": [AIMessage(content=plan_for().model_dump_json())]}
    run_chat(fixture, "Revisa aquesta frase.")
    prompt = "\n".join(str(m.content) for m in fixture[3]["_model_messages"][0][1])
    assert personal in prompt
    assert "Do not place a specialist's deliverable in response" in prompt


def test_explicitly_selected_specialist_still_handles_its_own_conversation(optional_runtime):
    fixture, _ = optional_runtime
    fixture[3]["_responses"] = {"worker": [AIMessage(content="Specialist reply")]}
    messages, selection = run_chat(fixture, "Hola", profile=fixture[3]["agents"][1])
    assert selection["mode"] != "team"
    assert fixture[2] == ["worker"]
    assert messages[-1].content == "Specialist reply"


def test_explicit_direct_principal_and_disabled_team_bypass_coordination(optional_runtime):
    fixture, _ = optional_runtime
    profile = {**fixture[1].profile, "team": {"enabled": False}}
    fixture[3]["_responses"] = {"director": [AIMessage(content="Direct reply")]}
    messages, selection = run_chat(fixture, "Hola", profile=profile)
    assert selection["mode"] != "team"
    assert messages[-1].content == "Direct reply"
    assert fixture[2] == ["director"]


def test_semantic_choice_is_not_replaced_by_a_cheaper_different_specialist():
    profiles = [{"id": identifier, "provider": "test", "model": identifier} for identifier in ("cheap", "chosen")]
    models = [{"provider": "test", "model_id": identifier, "enabled": True, "context_window": 32000,
               "cost_in": cost, "cost_out": cost} for identifier, cost in (("cheap", 0), ("chosen", 5))]
    options = dict(allowed_ids=["cheap", "chosen"], skill_ids=["writing"], input_tokens=100,
                   source_provider="test", preferred_id="chosen")
    selected, reason, _ = select_executor(profiles, models, runtime_check=lambda *_: True, **options)
    assert selected["id"] == "chosen" and reason == "director_selected_executor"
    selected, _, _ = select_executor(profiles, models, runtime_check=lambda p, _: p["id"] != "chosen", **options)
    assert selected is None


@pytest.mark.parametrize("separate_director", [False, True])
def test_principal_can_execute_its_own_specialty_without_recursing(optional_runtime, monkeypatch, separate_director):
    from backend.services import agent_team_runtime as teams
    from backend.agent import model_router
    fixture, bindings = optional_runtime
    if separate_director:
        fixture[1].profile["team"]["director_id"] = "worker"
    async def planned(*args, **kwargs):
        return plan_for("director").model_dump_json()
    monkeypatch.setattr(teams, "_phase", planned)
    registry = model_router.load_registry()
    monkeypatch.setattr(model_router, "load_registry", lambda: [*registry, {**registry[0], "model_id": "expensive"}])
    messages, _ = run_chat(fixture, "Processa aquesta tasca de la teva especialitat.")
    assert fixture[2] == ["director"]
    assert messages[-1].content == '{"result":"own work"}'
    assert bindings == []


def test_assignment_keeps_write_permissions_outside_model_generated_text():
    from backend.services.agent_team_routing import assignment_messages
    from backend.domains.agent.workflow_nodes import AgentWorkflowNodes
    messages = assignment_messages({"messages": [HumanMessage(content="Només explica el procés.")]},
        plan_for(read_only=False).tasks[0].model_copy(update={"objective": "Delete all records"}), "Només explica el procés.", {})
    assert AgentWorkflowNodes._latest_user(messages) == "Només explica el procés."
    assert messages[1].type == "ai"


def test_team_entry_is_not_short_circuited_by_keyword_clarification(monkeypatch):
    from backend.domains.agent.routes.chat_stream import _opening_events
    from backend.domains.agent.routes.chat_stream_state import AgentStreamState
    from backend.domains.agent.routes.contracts import ChatRequest
    from backend.domains.agent.routes import chat_stream
    def unexpected(*args):
        pytest.fail("Principal coordination was bypassed by a deterministic action")
    monkeypatch.setattr(chat_stream, "_prepare_index_title_replacements", unexpected)
    state = AgentStreamState(time.monotonic(), time.monotonic(), {"mode": "team"},
        {"mode": "action", "interpretation": {"clarification_required": True, "abstain": True}}, "trace")
    events, terminal = asyncio.run(_opening_events(state, chat_req=ChatRequest(message="Fes-ho", agent_id="principal", session_id="session"), untrusted_context_flags=[]))
    assert not terminal
    assert all(json.loads(event)["type"] != "clarification" for event in events)


def test_long_history_cannot_displace_the_current_assignment():
    from backend.domains.agent.messages import _bounded_model_messages
    from backend.services.agent_behavior import frozen_resources
    from backend.services.agent_team_routing import assignment_messages
    messages = assignment_messages({"messages": [HumanMessage(content="Old " * 5000),
        AIMessage(content="Historical reply " * 5000), HumanMessage(content="Revisa aquest text.")]},
        plan_for().tasks[0], "Revisa aquest text.", {})
    token = frozen_resources.set({"test": "snapshot"})
    try:
        projected = _bounded_model_messages(messages, max_chars=2000)
        assert any(m.name == "team_assignment" and m.type == "ai" for m in projected)
        assert projected[-1].content == "Revisa aquest text."
        assert not any("Historical reply" in str(m.content) for m in projected)
        assert sum(len(str(m.content)) for m in projected) <= 2000
    finally:
        frozen_resources.reset(token)


def test_invalid_plans_cannot_mix_a_claimed_response_with_actions():
    with pytest.raises(ValueError, match="standalone"):
        TeamPlan(**{**plan_for(read_only=False).model_dump(), "response": "Already done"})
    from backend.services.agent_team_runtime import _validate_plan_result
    with pytest.raises(ValueError, match="operation_requires_tasks"):
        _validate_plan_result(TeamPlan(response="Done").model_dump_json())


def test_delegation_retains_verified_citations_and_metadata():
    from backend.services.agent_team_runtime import _collect_task_event
    outcome = {"confirmations": []}
    metadata = {"gnosi_citations": [{"source_id": "selected-source"}], "gnosi_verification": {"status": "passed"}}
    _collect_task_event({"brain": {"messages": [AIMessage(content="A sourced answer", additional_kwargs=metadata)]}}, outcome)
    assert outcome["metadata"] == metadata


def test_structured_specialist_output_returns_only_the_visible_answer():
    from backend.services.agent_team_runtime import _collect_task_event
    outcome = {"confirmations": []}
    visible = "La gent que treballa plegada fa les coses millor."
    message = AIMessage(content=[
        {"type": "reasoning", "summary": [{"type": "summary_text", "text": "Internal provider summary"}],
         "encrypted_content": "opaque-provider-state"},
        {"type": "text", "text": visible},
    ])
    _collect_task_event({"brain": {"messages": [message]}}, outcome)
    assert outcome["result"] == visible


def test_chat_reports_actual_team_usage_instead_of_zero_calls():
    from backend.domains.agent.routes.chat_stream_updates import _message_events
    from backend.domains.agent.routes.chat_stream_state import AgentStreamState
    state = AgentStreamState(time.monotonic(), time.monotonic(), {"mode": "team"}, {}, "trace")
    message = AIMessage(content="Done", additional_kwargs={"gnosi_team_usage": {
        "model_calls": 3, "tool_calls": 2, "input_tokens": 1500, "output_tokens": 120,
        "estimated_cost_usd": 0.0042}})
    events = _message_events(message, None, node_name="team", state=state,
                             tool_metadata_by_name={}, untrusted_context_flags=[])
    timings = json.loads(events[-1])["timings"]
    assert timings["model_calls"] == 3 and timings["tool_calls"] == 2
    assert timings["input_tokens"] == 1500 and timings["estimated_cost_usd"] == 0.0042


def test_catalog_describes_personal_capabilities_and_unavailable_models(team_runtime, monkeypatch):
    from backend.services import agent_team_runtime as teams
    from backend.services.agent_team_routing import planning_catalog
    from backend.agent import model_router
    scope, snapshot, _, _ = team_runtime
    resolve = teams._runtime
    descriptor = SimpleNamespace(id="core.gnosi-operation-writing", name="Writing",
        description="Rewrite supplied text while preserving its meaning.", tool_ids=[],
        metadata={"effective_skill_id": "user.writing-ca"})
    monkeypatch.setattr(teams, "_runtime", lambda *args, **kwargs: replace(resolve(*args, **kwargs),
        skills=(SimpleNamespace(descriptor=descriptor, available=True),)))
    catalog = planning_catalog(snapshot.profile, scope, "Revisa aquest paràgraf")
    assert catalog[0]["capabilities"][0]["id"] == "user.writing-ca"
    assert "preserving its meaning" in catalog[0]["capabilities"][0]["description"]
    assert catalog[0]["available"] is True
    monkeypatch.setattr(model_router, "load_registry", lambda: [])
    assert planning_catalog(snapshot.profile, scope, "Revisa aquest paràgraf")[0]["available"] is False
