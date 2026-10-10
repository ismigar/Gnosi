"""Operation mismatches and malformed chat deliverables cannot report success."""
import json

import pytest
from langchain_core.messages import AIMessage

from backend.services.agent_team_contracts import output_schema, validate_plan_contract, required_operation
from backend.services.agent_team_models import TeamPlan, TeamTask
from backend.tests.test_agent_team import optional_runtime, team_runtime  # noqa: F401
from backend.tests.test_principal_agent_routing import run_chat

BOOLEAN = {"type": "object", "properties": {"value": {"type": "boolean"}},
           "required": ["value"], "additionalProperties": False}


def test_plugin_operation_prefix_does_not_borrow_an_application_skill():
    assert required_operation("knowledge.process-source.phase", ["plugin.llm-wiki.process-source"]) == ""
    assert required_operation("knowledge.classify", ["core.gnosi-operation-knowledge"]) == "knowledge"


def table_plan():
    return TeamPlan(operation="tables", output_schema_json=json.dumps(BOOLEAN),
                    tasks=[TeamTask(id="field", agent_id="worker", objective="Compute the requested typed field",
                                    skill_ids=["core.gnosi-operation-tables"])], result_task="field")


def members():
    return [{"id": identifier, "available": True, "skills": [skill], "capabilities": []}
            for identifier, skill in (("writer", "core.gnosi-operation-writing"),
                                      ("worker", "core.gnosi-operation-tables"))]


def test_table_operation_cannot_be_assigned_to_writing_even_with_valid_json():
    plan = table_plan()
    plan.tasks[0].agent_id = "writer"
    plan.tasks[0].skill_ids = ["core.gnosi-operation-writing"]
    with pytest.raises(ValueError, match="operation_skill_required"):
        validate_plan_contract(plan, members(), "director")


@pytest.mark.parametrize("response", ['{"value":false}', '{\u200b'])
def test_coordinator_cannot_bypass_available_specialist_with_a_json_response(response):
    with pytest.raises(ValueError, match="specialist_required"):
        validate_plan_contract(TeamPlan(operation="tables", response=response, response_kind="conversation"),
                               members(), "director")


def test_clarification_and_greeting_remain_possible_but_unavailability_is_checked():
    validate_plan_contract(TeamPlan(operation="tables", response="Quin camp?", response_kind="clarification"), members(), "director")
    validate_plan_contract(TeamPlan(response="Hola!", response_kind="greeting"), members(), "director")
    with pytest.raises(ValueError, match="specialist_required"):
        validate_plan_contract(TeamPlan(operation="tables", response="No hi ha aquesta habilitat.", response_kind="unavailable"), members(), "director")
    unavailable = [{**m, "available": False} for m in members()]
    validate_plan_contract(TeamPlan(operation="tables", response="No hi ha aquesta habilitat.", response_kind="unavailable"), unavailable, "director")


def test_operation_checks_respect_personal_skill_aliases_and_server_operation():
    plan = table_plan()
    plan.tasks[0].skill_ids = ["user.fields"]
    catalog = [{"id": "worker", "available": True, "skills": ["user.fields"], "capabilities": [{
        "id": "user.fields", "canonical_id": "core.gnosi-operation-tables", "available": True,
        "application_operation": "tables"}]}]
    validate_plan_contract(plan, catalog, "director", required_operation="tables")
    with pytest.raises(ValueError, match="operation_mismatch"):
        validate_plan_contract(plan, catalog, "director", required_operation="writing")


@pytest.mark.parametrize("schema", [[], {"type": "nonsense"}, {"$ref": "https://example.test/schema"},
                                     {"properties": {"value": {"pattern": "(a+)+"}}}])
def test_model_generated_schemas_are_checked_locally_without_external_references(schema):
    with pytest.raises(ValueError, match="output_schema_invalid"):
        output_schema(TeamPlan(response="hello", output_schema_json=json.dumps(schema)))


def test_reference_names_in_data_fields_are_not_schema_references():
    schema = {"type": "object", "properties": {"$ref": {"type": "string"}}, "required": ["$ref"]}
    assert output_schema(TeamPlan(response="hello", output_schema_json=json.dumps(schema))) == schema


def prepare(fixture, monkeypatch, outputs):
    from backend.domains.agent import workflow
    fixture[1].profile["team"]["direct_routes"] = []
    fixture[3]["agents"][1]["skill_ids"] = ["core.gnosi-operation-tables"]
    fixture[3]["_responses"] = {"director": [AIMessage(content=table_plan().model_dump_json())],
                               "worker": [AIMessage(content=output) for output in outputs]}
    resolve = workflow.resolve_model
    models = {}
    def shared_model(profile, **kwargs):
        identifier = profile.agent_data["id"]
        if identifier not in models:
            models[identifier] = resolve(profile, **kwargs)
        return models[identifier]
    monkeypatch.setattr(workflow, "resolve_model", shared_model)


def test_valid_json_completes_without_an_extra_model_call(optional_runtime, monkeypatch):
    from backend.services import agent_execution_store as store, agent_team_store as artifacts
    fixture, _ = optional_runtime
    prepare(fixture, monkeypatch, ['{"value":false}'])
    messages, _ = run_chat(fixture, "Calcula el camp booleà completat de subtasques=[true,false]. Retorna JSON value; no desis res.")
    assert fixture[2] == ["director", "worker"]
    assert json.loads(messages[-1].content) == {"value": False}
    assert messages[-1].additional_kwargs["gnosi_team_output"]["status"] == "validated"
    assert all(run.status == "completed" for run in store.list_runs(fixture[0]))
    assert len(artifacts.list_artifacts(fixture[0], "task")) == 1


@pytest.mark.parametrize("invalid", ['{\u200b', '{"value":"false"}', '{"value":false,"other":1}'])
def test_invalid_json_is_repaired_once_by_the_same_executor_before_completion(optional_runtime, monkeypatch, invalid):
    from backend.services import agent_execution_store as store, agent_team_store as artifacts
    fixture, _ = optional_runtime
    prepare(fixture, monkeypatch, [invalid, '{"value":false}'])
    messages, _ = run_chat(fixture, "Calcula el camp booleà completat de subtasques=[true,false]. Retorna JSON value; no desis res.")
    assert fixture[2] == ["director", "worker", "worker"]
    assert json.loads(messages[-1].content) == {"value": False}
    assert messages[-1].additional_kwargs["gnosi_team_output"]["status"] == "repaired"
    runs = store.list_runs(fixture[0])
    repair = next(run for run in runs if run.operation == "team.repair")
    assert repair.agent_id == "worker" and repair.status == "completed" and repair.model_calls == 1
    assert len(artifacts.list_artifacts(fixture[0], "task")) == 1
    assert not artifacts.list_artifacts(fixture[0], "replan")
    with store.connect() as db:
        request = json.loads(db.execute("SELECT request FROM agent_runs WHERE run_id=?", (repair.run_id,)).fetchone()[0])
        assert request["tool_mode"] == "none" and request["max_model_calls"] == 1
        assert "subtasques=[true,false]" in request["data"]["original_input"]
    usage = messages[-1].additional_kwargs["gnosi_team_usage"]
    assert usage["phases"]["repair"]["model_calls"] == 1


def test_failed_repair_is_a_failed_run_and_does_not_rerun_the_task(optional_runtime, monkeypatch):
    from backend.services import agent_execution_store as store, agent_team_store as artifacts
    from backend.services.agent_team_output import TeamOutputContractError
    fixture, _ = optional_runtime
    prepare(fixture, monkeypatch, ['{"value":"false"}', '{"value":"false"}'])
    with pytest.raises(TeamOutputContractError):
        run_chat(fixture, "Calcula el camp booleà. Retorna JSON value.")
    assert fixture[2] == ["director", "worker", "worker"]
    assert not artifacts.list_artifacts(fixture[0], "replan")
    assert len(artifacts.list_artifacts(fixture[0], "task")) == 1
    assert all(run.status == "failed" for run in store.list_runs(fixture[0]) if run.operation != "team.plan")


@pytest.mark.parametrize("bad_plan", ["writer", "direct_response"])
def test_invalid_operation_plan_is_repaired_before_an_executor_runs(optional_runtime, monkeypatch, bad_plan):
    fixture, _ = optional_runtime
    prepare(fixture, monkeypatch, ['{"value":false}'])
    if bad_plan == "writer":
        invalid = table_plan()
        writer = {**fixture[3]["agents"][1], "id": "writer", "skill_ids": ["core.gnosi-operation-writing"]}
        fixture[3]["agents"].append(writer)
        fixture[1].profile["team"]["members"].append({"agent_id": "writer", "roles": ["expert"]})
        invalid.tasks[0].agent_id = "writer"
        invalid.tasks[0].skill_ids = ["core.gnosi-operation-writing"]
    else:
        invalid = TeamPlan(operation="tables", response='{"value":false}', response_kind="conversation")
    fixture[3]["_responses"]["director"] = [AIMessage(content=invalid.model_dump_json()),
                                             AIMessage(content=table_plan().model_dump_json())]
    messages, _ = run_chat(fixture, "Calcula el camp booleà. Retorna JSON value.")
    assert fixture[2] == ["director", "director", "worker"]
    assert json.loads(messages[-1].content) == {"value": False}


def test_synthesis_json_has_one_bounded_action_free_repair(optional_runtime):
    import asyncio
    from backend.services import agent_execution_store as store, agent_team_runtime as teams
    from backend.services.agent_execution_models import AgentRun
    from backend.services.agent_execution_scope import execution_scope
    fixture, _ = optional_runtime
    scope, snapshot, calls, config = fixture
    config["_responses"] = {"director": [AIMessage(content='{"value":"false"}'), AIMessage(content='{"value":false}')]}
    store.create(AgentRun(run_id="synthesis-root", agent_id="director", skill_id="", operation="conversation",
                         origin="chat", status="running", created_at=0, updated_at=0), scope, {}, snapshot.model_dump())
    with execution_scope(scope):
        result = asyncio.run(teams._phase(snapshot.profile, "synthesis-root", scope,
                             '{"request":"Return the boolean value from completed evidence"}', BOOLEAN, "team.synthesis"))
    assert json.loads(result) == {"value": False} and calls == ["director", "director"]
    phase = next(run for run in store.list_runs(scope) if run.operation == "team.synthesis")
    assert phase.status == "completed" and phase.model_calls == 2
    with store.connect() as db:
        request = json.loads(db.execute("SELECT request FROM agent_runs WHERE run_id=?", (phase.run_id,)).fetchone()[0])
        assert request["tool_mode"] == "none" and request["max_model_calls"] == 2
