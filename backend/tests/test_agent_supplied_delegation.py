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


def test_supplied_field_worker_repairs_a_string_boolean_without_replanning(optional_runtime, monkeypatch):
    fixture, _ = optional_runtime
    prepare(fixture, monkeypatch, ['{"value":"true"}', '{"value":true}'])
    messages, _ = run_chat(fixture, WORD_FIELD_REQUEST, supplied_operation="tables")
    assert fixture[2] == ["worker", "worker"]
    assert messages[-1].additional_kwargs["gnosi_team_output"]["status"] == "repaired"
    assert json.loads(messages[-1].content) == {"value": True}


def test_plain_translation_preserves_the_literal_and_reaches_the_translator(optional_runtime):
    fixture, _ = optional_runtime
    fixture[3]["agents"][1]["skill_ids"] = [skill_id("translation")]
    fixture[3]["_responses"] = {"worker": [AIMessage(content="The train leaves at nine.")]}
    messages, _ = run_chat(fixture, TRANSLATE, refs=[READER], supplied_operation=supplied_chat_operation(TRANSLATE))
    assert fixture[2] == ["worker"]
    assert messages[-1].content == "The train leaves at nine."
    worker_input = fixture[3]["_model_messages"][-1][1]
    assert [m.content for m in worker_input if isinstance(m, HumanMessage)] == [TRANSLATE]


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
