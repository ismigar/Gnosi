"""Ordinary self-contained chats exercise the same specialists and output checks as planned work."""
import json

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from backend.domains.agent.context import build_agent_turn_plan
from backend.domains.agent.supplied_tasks import supplied_chat_operation
from backend.services import agent_team_store as artifacts
from backend.services.agent_operation_catalog import skill_id
from backend.tests.test_agent_team import optional_runtime, team_runtime  # noqa: F401
from backend.tests.test_agent_team_contracts import WORD_FIELD_REQUEST, prepare, table_plan
from backend.tests.test_principal_agent_routing import run_chat

READER = {"id": "reader", "type": "internal", "ref": "reader", "label": "Reader"}
TRANSLATE = "Tradueix a l’anglès aquesta frase: «El tren surt a les nou.» Respon només amb la traducció."


def test_supplied_field_with_passive_reader_calls_only_the_eligible_specialist(optional_runtime, monkeypatch):
    fixture, _ = optional_runtime
    prepare(fixture, monkeypatch, ['{"value":true}'])
    request = WORD_FIELD_REQUEST
    operation = supplied_chat_operation(request)
    plan = build_agent_turn_plan(request, context_refs=[READER], supplied_input=bool(operation))
    assert plan["required_tool"] is None
    assert build_agent_turn_plan("Cerca notícies sobre trens.", context_refs=[READER])["required_tool"] == "search_reader_context"
    messages, _ = run_chat(fixture, request, refs=[READER], supplied_operation=operation)
    assert fixture[2] == ["worker"]
    assert json.loads(messages[-1].content) == {"value": True}
    assert messages[-1].additional_kwargs["gnosi_team_output"]["status"] == "validated"
    assert artifacts.list_artifacts(fixture[0], "routing")[0]["reason"] == "unique_eligible_specialist"


def test_planning_reads_candidates_once_and_dispatch_observes_a_new_budget_block(optional_runtime, monkeypatch):
    from backend.agent import model_router
    from backend.services import agent_team_planning, agent_team_runtime

    fixture, _ = optional_runtime
    prepare(fixture, monkeypatch, ['{"value":true}'])
    read_inputs = agent_team_runtime.candidate_inputs
    record = agent_team_planning.record
    planned = False
    reads = []

    def observe_inputs(config):
        reads.append("dispatch" if planned else "planning")
        return read_inputs(config)

    def record_route(kind, value):
        nonlocal planned
        record(kind, value)
        if kind == "team.route":
            assert value["reason"] == "unique_eligible_specialist"
            planned = True

    monkeypatch.setattr(agent_team_runtime, "candidate_inputs", observe_inputs)
    monkeypatch.setattr(agent_team_planning, "record", record_route)
    monkeypatch.setattr(model_router, "budget_status", lambda: {"over_cap": planned, "budget": {"enforce_block": True}})
    with pytest.raises(RuntimeError, match="agent_team_no_eligible_executor"):
        run_chat(fixture, WORD_FIELD_REQUEST, supplied_operation="tables")
    assert reads == ["planning", "dispatch"]
    assert fixture[2] == []


@pytest.mark.parametrize("request_text", [
    WORD_FIELD_REQUEST,
    'Sample row: stock=4. Calculate whether stock > 0. Return just a JSON object with the boolean field "value".',
    'Sample row: stock=4. Calculate whether stock > 0 return only a JSON object with the boolean field "value".',
])
def test_supplied_field_worker_repairs_a_string_boolean_without_replanning(optional_runtime, monkeypatch, request_text):
    fixture, _ = optional_runtime
    prepare(fixture, monkeypatch, ['{"value":"true"}', '{"value":true}'])
    messages, _ = run_chat(fixture, request_text, supplied_operation=supplied_chat_operation(request_text))
    assert fixture[2] == ["worker", "worker"]
    assert messages[-1].additional_kwargs["gnosi_team_output"]["status"] == "repaired"
    assert json.loads(messages[-1].content) == {"value": True}


@pytest.mark.parametrize("text", [TRANSLATE, "Translate into French: «" + "Clouds cover the sky. " * 375 + "»"],
                         ids=["short-passage", "long-passage"])
def test_plain_translation_preserves_the_literal_and_reaches_the_translator(optional_runtime, monkeypatch, text):
    from dataclasses import replace
    from backend.domains.agent import workflow

    fixture_prompts = workflow.build_prompts
    # Allocate room for the long passage alongside the fixture's tool schemas.
    monkeypatch.setattr(workflow, "build_prompts", lambda *a, **kw: replace(fixture_prompts(*a, **kw), model_input_chars=80000))
    fixture, _ = optional_runtime
    fixture[3]["agents"][1]["skill_ids"] = [skill_id("translation")]
    fixture[3]["_responses"] = {"worker": [AIMessage(content="The train leaves at nine.")]}
    messages, _ = run_chat(fixture, text, refs=[READER], supplied_operation=supplied_chat_operation(text))
    assert fixture[2] == ["worker"]
    assert messages[-1].content == "The train leaves at nine."
    worker_input = fixture[3]["_model_messages"][-1][1]
    assert [m.content for m in worker_input if isinstance(m, HumanMessage)] == [text]
    assignment = next(m for m in worker_input if m.name == "team_assignment" and isinstance(m, AIMessage))
    assert text not in assignment.content


def test_translation_fits_the_workers_window_with_a_single_copy_of_the_source(optional_runtime, monkeypatch):
    from backend.agent import model_router
    fixture, _ = optional_runtime
    fixture[3]["agents"][1]["skill_ids"] = [skill_id("translation")]
    fixture[3]["_responses"] = {"worker": [AIMessage(content="Les nuages couvrent le ciel.")]}
    registry = model_router.load_registry()
    monkeypatch.setattr(model_router, "load_registry", lambda: [{**r, "context_window": 7800} for r in registry])
    text = "Translate into French: «" + "Clouds cover the sky. " * 115 + "»"
    messages, _ = run_chat(fixture, text, supplied_operation=supplied_chat_operation(text))
    assert fixture[2] == ["worker"]
    assert messages[-1].content == "Les nuages couvrent le ciel."


@pytest.mark.parametrize("allowlist", [False, True])
def test_two_specialists_need_a_plan_unless_the_configured_route_picks_one(optional_runtime, monkeypatch, allowlist):
    fixture, _ = optional_runtime
    prepare(fixture, monkeypatch, ['{"value":true}'])
    config = fixture[3]
    config["agents"].append({**config["agents"][1], "id": "second"})
    team = config["agents"][0]["team"]
    team["members"].append({"agent_id": "second", "roles": ["worker"]})
    team["direct_routes"] = [{"operation": "tables", "agent_ids": ["worker"]}] if allowlist else []
    fixture[1].profile["team"] = team
    config["_responses"]["director"] = [AIMessage(content=table_plan().model_dump_json())]
    messages, _ = run_chat(fixture, WORD_FIELD_REQUEST, supplied_operation="tables")
    assert fixture[2] == (["worker"] if allowlist else ["director", "worker"])
    assert json.loads(messages[-1].content) == {"value": True}


def test_routine_uses_the_only_translator_whose_model_fits_the_assignment(optional_runtime, monkeypatch):
    from backend.agent import model_router

    fixture, _ = optional_runtime
    config = fixture[3]
    owner, small = config["agents"]
    small["skill_ids"] = [skill_id("translation")]
    large = {**small, "id": "large-translator", "model": "roomy"}
    config["agents"].append(large)
    owner["team"]["members"].append({"agent_id": large["id"], "roles": ["worker"]})
    fixture[1].profile["team"] = owner["team"]
    smaller = model_router.load_registry()[0]
    monkeypatch.setattr(model_router, "load_registry", lambda: [
        {**smaller, "context_window": 4800}, {**smaller, "model_id": "roomy", "context_window": 32000},
    ])
    config["_responses"] = {large["id"]: [AIMessage(content="Les nuages couvrent le ciel.")]}
    request = "Translate to French: «" + "Clouds cover the sky. " * 115 + "»"
    messages, _ = run_chat(fixture, request, supplied_operation=supplied_chat_operation(request))
    assert fixture[2] == [large["id"]]
    assert messages[-1].content == "Les nuages couvrent le ciel."


@pytest.mark.parametrize("configured", [True, False])
def test_full_history_falls_back_to_the_director_if_no_worker_can_accept_it(optional_runtime, monkeypatch, configured):
    from backend.agent import model_router
    from backend.services.agent_team_models import TeamPlan

    fixture, _ = optional_runtime
    config = fixture[3]
    owner, worker = config["agents"]
    worker["skill_ids"] = [skill_id("translation")]
    owner["team"]["direct_routes"] = [{"operation": "translation", "agent_ids": [worker["id"]]}] if configured else []
    fixture[1].profile["team"] = owner["team"]
    registry = model_router.load_registry()
    monkeypatch.setattr(model_router, "load_registry", lambda: [{**r, "context_window": 7800} for r in registry])
    clarification = "Can you start a shorter conversation for the translation?"
    config["_responses"] = {"director": [AIMessage(content=TeamPlan(
        response_kind="clarification", response=clarification).model_dump_json())]}
    history = [HumanMessage(content="Earlier synthetic topic. " * 400)]
    messages, _ = run_chat(fixture, TRANSLATE, history=history, supplied_operation=supplied_chat_operation(TRANSLATE))
    assert fixture[2] == ["director"]
    assert messages[-1].content == clarification
