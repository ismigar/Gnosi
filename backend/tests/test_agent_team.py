"""Team routing and runtime conformance without live providers or user data."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from backend.services.agent_team_models import AgentTeam, TeamPlan, TEAM_SKILL
from backend.services.agent_team_policy import chat_operation, estimate_cost, select_executor, validate_teams
from backend.services.model_role_suitability import assess_roles


def test_only_complete_unambiguous_text_requests_route_directly():
    assert chat_operation("Tradueix al francès: Bon dia") == "translation"
    assert chat_operation("Summarize: A long text") == "writing"
    for text in ["Resumeix això", "No tradueixis al francès: text", "Translate and publish: text", "Com puc resumir?"]:
        assert chat_operation(text) == ""


def test_cost_unknown_is_not_zero_and_context_and_capabilities_precede_cost():
    profiles = [{"id": str(i), "provider": "local", "model": str(i)} for i in range(4)]
    models = [dict(provider="local", model_id=str(i), enabled=True, context_window=8000, cost_in=i, cost_out=i, tags=["tools"]) for i in range(4)]
    models[0]["cost_in"] = None
    models[1]["context_window"] = 10
    kwargs = dict(allowed_ids=["0", "1", "2", "3"], skill_ids=["read"], input_tokens=1000,
        source_provider="local", runtime_check=lambda p, s: p["id"] != "2", require_tools=True)
    selected, reason, cost = select_executor(profiles, models, **kwargs)
    assert selected["id"] == "3" and reason == "lowest_estimated_cost" and cost > 0
    assert estimate_cost({"is_local": True}, 1000) is None
    assert estimate_cost({"cost_in": float("nan"), "cost_out": 1}, 1000) is None


def test_local_only_cannot_route_to_cloud():
    selected, _, _ = select_executor([{"id": "cloud", "provider": "remote", "model": "m"}],
        [{"provider": "remote", "model_id": "m", "enabled": True, "context_window": 8000, "cost_in": 0, "cost_out": 0}],
        allowed_ids=["cloud"], skill_ids=[], input_tokens=1, source_provider="ollama", runtime_check=lambda *_: True)
    assert selected is None


def test_team_validation_is_additive_and_rejects_unlisted_routes():
    old = {"agents": [{"id": "old", "persona": "mine", "model": "fixed"}]}
    validate_teams(old, [])
    assert old["agents"][0] == {"id": "old", "persona": "mine", "model": "fixed"}
    with pytest.raises(ValueError):
        AgentTeam.model_validate({"enabled": True, "director_id": "d", "direct_routes": [{"operation": "writing", "agent_ids": ["foreign"]}]})


def test_plan_rejects_cycles_and_more_than_four_assignments():
    task = {"id": "a", "agent_id": "worker", "objective": "Read", "skill_ids": ["read"], "depends_on": ["a"]}
    with pytest.raises(ValueError):
        TeamPlan(tasks=[task], result_task="a")


def test_roles_overlap_and_language_and_citations_remain_unverified():
    roles = {r["role"]: r for r in assess_roles({"tags": ["tools", "reasoning"], "context_window": 200000, "modes": ["text"]})}
    assert roles["director"]["status"] == roles["documentalist"]["status"] == "insufficient_data"
    assert "catalan_quality" in roles["allrounder"]["missing"]
    assert "citation_fidelity" in roles["documentalist"]["missing"]
    assert all(r["status"] != "tested" for r in roles.values())


@pytest.fixture
def team_runtime(monkeypatch, tmp_path):
    from backend.services import agent_execution as execution, agent_execution_store as store, agent_team_runtime as teams
    from backend.services.agent_execution_models import AgentExecutionSnapshot, ExecutionScope
    from backend.services.agent_skill_catalog import AgentRuntimeCapabilities
    from backend.config import app_config
    from backend.services import agent_skill_catalog
    from backend.agent import factory, model_router
    from backend.domains.agent.operation_graph import operation_workflow
    from langchain_core.language_models.fake_chat_models import FakeListChatModel
    scope = ExecutionScope(user_id="alice", workspace_id="test", role="owner", vault_path=str(tmp_path))
    writing = "core.gnosi-operation-writing"
    owner = {"id": "director", "provider": "local", "model": "expensive", "skill_ids": [TEAM_SKILL, writing],
        "_execution_detailed_persona": "", "team": {"enabled": True, "director_id": "director", "members": [{"agent_id": "worker", "roles": ["worker"]}],
            "direct_routes": [{"operation": "writing", "agent_ids": ["worker"]}]}}
    worker = {"id": "worker", "provider": "local", "model": "cheap", "skill_ids": [writing], "_execution_detailed_persona": ""}
    config = {"agents": [owner, worker], "providers": {"local": {}}}
    def runtime(p, vault_path=None, active_skill_ids=None):
        skills = tuple(s for s in (active_skill_ids or p.get("skill_ids", [])) if s in p.get("skill_ids", []))
        return AgentRuntimeCapabilities(tuple(p["skill_ids"]), skills, ("procedure",), (), (), (), (), (), "1")
    monkeypatch.setattr(app_config, "load_params", lambda **_: SimpleNamespace(ai=config, paths={}))
    monkeypatch.setattr(teams, "_config", lambda: config)
    monkeypatch.setattr(agent_skill_catalog, "resolve_agent_runtime", runtime)
    monkeypatch.setattr(store, "resolve_data_dir", lambda **_: tmp_path)
    monkeypatch.setattr(execution, "revalidate_scope", lambda _: None)
    monkeypatch.setattr(model_router, "budget_status", lambda: {"over_cap": False})
    monkeypatch.setattr(model_router, "load_registry", lambda: [{"provider": "local", "model_id": "cheap", "enabled": True,
        "context_window": 32000, "cost_in": 1, "cost_out": 1, "tags": ["tools"]}])
    calls = []
    async def create(*args, **kwargs):
        p = kwargs["prepared_agent_data"]
        root = teams.build_team_workflow(SimpleNamespace(agent_data=p, resolved_runtime=kwargs["runtime_capabilities"]),
            operation_mode=kwargs.get("operation_mode", False), original=kwargs["user_message"])
        if root:
            return root
        calls.append(p["id"])
        responses = config.get("_responses", {}).get(p["id"], [])
        response = responses.pop(0) if responses else '{"result":"done"}'
        return operation_workflow(FakeListChatModel(responses=[response]), "Complete the request", 32000), {"provider": p["provider"], "model": p["model"]}
    monkeypatch.setattr(factory, "create_agent_workflow", create)
    snapshot = AgentExecutionSnapshot(scope=scope, agent_id=owner["id"], profile=owner, skill_ids=[writing],
        instructions=["procedure"], catalog_revision="1", revision="1")
    return scope, snapshot, calls, config


def test_direct_operation_calls_only_worker_and_records_child(team_runtime):
    from backend.services.agent_execution_scope import execution_scope
    from backend.services.agent_execution import execute_operation
    from backend.services.agent_execution_models import AgentOperation
    from backend.services import agent_execution_store as store
    from backend.agent.action_confirmations import confirmation_context
    scope, snapshot, calls, _ = team_runtime
    with execution_scope(scope), confirmation_context(vault_scope="test", workspace_id="test", user_id="alice", role="owner", agent_id="director", session_id="s"):
        run = asyncio.run(execute_operation(AgentOperation(skill_id=snapshot.skill_ids[0], operation="writing", input="Summarize this", output_schema={"type": "object"}), snapshot=snapshot))
    assert calls == ["worker"]
    assert json.loads(run.result) == {"result": "done"}
    children = [r for r in store.list_runs(scope) if r.parent_run_id == run.run_id]
    assert len(children) == 1 and children[0].agent_id == "worker" and children[0].model_calls == 1
    assert run.model_calls == 0


def test_team_artifacts_are_private(team_runtime):
    from backend.services import agent_execution_store as store, agent_team_store as artifacts
    from backend.services.agent_execution_models import AgentRun
    scope, snapshot, _, _ = team_runtime
    store.create(AgentRun(run_id="root", agent_id="director", skill_id="", operation="team", origin="chat", status="running", created_at=0, updated_at=0), scope, {}, snapshot.model_dump())
    artifacts.put(scope, "root", "private", "temporary", {"private": True})
    other = scope.model_copy(update={"user_id": "bob"})
    assert artifacts.list_artifacts(other, "temporary") == []
    with pytest.raises(LookupError):
        artifacts.get(other, "root", "private")


def run_operation(fixture, *, schema=None):
    from backend.services.agent_execution_scope import execution_scope
    from backend.services.agent_execution import execute_operation
    from backend.services.agent_execution_models import AgentOperation
    scope, snapshot, _, _ = fixture
    with execution_scope(scope):
        return asyncio.run(execute_operation(AgentOperation(skill_id=snapshot.skill_ids[0], operation="writing", input="Summarize this", output_schema=schema), snapshot=snapshot))


def test_direct_route_does_not_escape_configured_shortlist(team_runtime):
    _, snapshot, calls, config = team_runtime
    other = {**config["agents"][1], "id": "unlisted"}
    config["agents"].insert(1, other)
    snapshot.profile["team"]["members"].insert(0, {"agent_id": "unlisted", "roles": ["worker"]})
    config["agents"][0]["team"] = snapshot.profile["team"]
    run_operation(team_runtime)
    assert calls == ["worker"]


def test_format_repair_calls_executor_once_without_replanning(team_runtime):
    _, _, calls, config = team_runtime
    config["_responses"] = {"worker": ["bad JSON", '{"result":"fixed"}']}
    result = run_operation(team_runtime, schema={"type": "object"})
    assert json.loads(result.result) == {"result": "fixed"}
    assert calls == ["worker", "worker"]
    from backend.services import agent_team_store as artifacts
    assert len(artifacts.list_artifacts(team_runtime[0], "task", result.run_id)) == 1


def test_ambiguous_operation_plans_then_delivers_without_director_review(team_runtime):
    _, snapshot, calls, config = team_runtime
    snapshot.profile["team"]["direct_routes"] = []
    config["agents"][0]["team"] = snapshot.profile["team"]
    config["_responses"] = {"director": [json.dumps({"tasks": [{"id": "read", "agent_id": "worker", "objective": "Summarize", "skill_ids": snapshot.skill_ids}], "result_task": "read", "synthesize": False})]}
    run_operation(team_runtime)
    assert calls == ["director", "worker"]


def test_temporary_creation_cannot_widen_policy(team_runtime):
    from backend.services.agent_team_models import TemporaryAgentSpec
    from backend.services.agent_team_runtime import validate_temporary
    scope, snapshot, _, _ = team_runtime
    spec = TemporaryAgentSpec(name="Specialist", instructions="Use evidence", provider="remote", model="anything", skill_ids=snapshot.skill_ids, acceptance=["Cite evidence"])
    with pytest.raises(PermissionError, match="temporary_disabled"):
        validate_temporary(spec, snapshot.profile, scope)
    snapshot.profile["team"]["temporary"] = {"enabled": True, "models": [{"provider": "local", "model": "cheap"}], "skill_ids": snapshot.skill_ids}
    with pytest.raises(PermissionError, match="model_not_allowed"):
        validate_temporary(spec, snapshot.profile, scope)
    with pytest.raises(PermissionError, match="skill_not_allowed"):
        validate_temporary(spec.model_copy(update={"provider": "local", "model": "cheap", "skill_ids": [TEAM_SKILL]}), snapshot.profile, scope)


def test_revoked_team_cannot_continue_child(team_runtime):
    from backend.services import agent_execution_store as store
    from backend.services.agent_execution_models import AgentRun
    from backend.services.agent_team_runtime import execution_profile
    scope, snapshot, _, config = team_runtime
    store.create(AgentRun(run_id="r", agent_id="director", skill_id="", operation="team", origin="chat", status="running", created_at=0, updated_at=0), scope, {}, snapshot.model_dump())
    child = snapshot.model_copy(update={"agent_id": "worker", "profile": {"_team_execution": {"root_id": "r", "owner_id": "director"}}})
    assert execution_profile(child)["id"] == "worker"
    config["agents"][0]["team"]["enabled"] = False
    with pytest.raises(PermissionError, match="revoked"):
        execution_profile(child)


def test_global_budget_counts_descendant_calls_once(team_runtime):
    from backend.services import agent_execution_store as store
    from backend.services.agent_execution_models import AgentRun
    scope, snapshot, _, _ = team_runtime
    for identifier, parent in [("root", ""), ("a", "root"), ("b", "root")]:
        store.create(AgentRun(run_id=identifier, parent_run_id=parent, agent_id="director", skill_id="", operation="team", origin="chat", status="running", created_at=0, updated_at=0), scope, {"max_calls": 2}, snapshot.model_dump())
    store.reserve_model_call(scope, "a", 8)
    store.reserve_model_call(scope, "b", 8)
    with pytest.raises(RuntimeError, match="budget_exceeded"):
        store.reserve_model_call(scope, "a", 8)
    assert sum(r.model_calls for r in store.list_runs(scope)) == 2


def test_completed_assignments_are_reused_on_resume(team_runtime):
    from backend.services import agent_execution_store as store
    from backend.services.agent_execution import resume_run
    from backend.services.agent_execution_scope import execution_scope
    scope, _, calls, _ = team_runtime
    run = run_operation(team_runtime)
    store.update(scope, run.run_id, status="interrupted")
    with execution_scope(scope):
        resumed = asyncio.run(resume_run(run.run_id))
    assert resumed.status == "completed" and resumed.run_id == run.run_id
    assert calls == ["worker"]


def test_team_measurements_do_not_count_job_rollups_or_invent_prices():
    from backend.services.agent_team_evaluations import measure_case
    from backend.services.agent_execution_models import AgentRun
    base = dict(skill_id="", operation="writing", origin="button", status="completed", created_at=0, updated_at=0, usage_available=True, input_tokens=100, output_tokens=10)
    runs = [AgentRun(**base, run_id="job", agent_id="d", model_calls=2),
        AgentRun(**base, run_id="plan", parent_run_id="job", agent_id="d", provider="p", model="big", model_calls=1),
        AgentRun(**base, run_id="work", parent_run_id="job", agent_id="w", provider="p", model="small", model_calls=1)]
    result = measure_case("same_task", "director_always", runs, [], director_id="d", contract_valid=True, direct_route_available=True, necessary_assignments=1)
    assert result["model_calls"] == 2 and result["avoidable_director_calls"] == 1
    assert result["cost_usd"] is None and result["unnecessary_assignments"] == 0


@pytest.mark.parametrize("strategy,expected_calls", [("allrounder", ["director"]), ("director_always", ["director", "worker"]), ("director_direct", ["worker"])])
def test_identical_case_compares_three_execution_policies(team_runtime, strategy, expected_calls):
    _, snapshot, calls, config = team_runtime
    if strategy == "allrounder":
        snapshot.profile["team"]["enabled"] = False
    elif strategy == "director_always":
        snapshot.profile["team"]["direct_routes"] = []
        config["_responses"] = {"director": [json.dumps({"tasks": [{"id": "read", "agent_id": "worker", "objective": "Summarize", "skill_ids": snapshot.skill_ids}], "result_task": "read"})]}
    config["agents"][0]["team"] = snapshot.profile["team"]
    result = run_operation(team_runtime, schema={"type": "object", "required": ["result"]})
    assert json.loads(result.result) == {"result": "done"}
    assert calls == expected_calls


def test_temporary_is_scoped_reused_and_limited(team_runtime, monkeypatch):
    from backend.services import agent_execution_store as store, agent_team_runtime as teams, agent_team_store as artifacts
    from backend.services.agent_execution_models import AgentRun
    from backend.services.agent_team_models import TemporaryAgentSpec
    scope, snapshot, _, _ = team_runtime
    store.create(AgentRun(run_id="root", agent_id="director", skill_id="", operation="team", origin="chat", status="running", created_at=0, updated_at=0), scope, {}, snapshot.model_dump())
    monkeypatch.setattr(teams, "validate_temporary", lambda *_: None)
    spec = TemporaryAgentSpec(name="Specialist", instructions="A reusable method", provider="local", model="cheap", skill_ids=snapshot.skill_ids, acceptance=["Return evidence"])
    first = teams._temporary(spec, snapshot.profile, "root", scope)
    assert teams._temporary(spec, snapshot.profile, "root", scope) == first
    teams._temporary(spec.model_copy(update={"name": "Second"}), snapshot.profile, "root", scope)
    with pytest.raises(RuntimeError, match="temporary_limit"):
        teams._temporary(spec.model_copy(update={"name": "Third"}), snapshot.profile, "root", scope)
    assert len(artifacts.list_artifacts(scope, "temporary", "root")) == 2
    assert all(p["id"] != first["id"] for p in team_runtime[3]["agents"])


@pytest.mark.parametrize("add_to_team", [False, True])
def test_retention_requires_review_and_preserves_only_reviewed_configuration(team_runtime, monkeypatch, add_to_team):
    import threading
    from backend.config import app_config
    from backend.services import agent_execution_store as store, agent_team_runtime as teams, agent_team_store as artifacts, agent_skill_assignments
    from backend.services.agent_execution_models import AgentRun
    from backend.services.agent_team_models import TemporaryAgentSpec
    scope, snapshot, _, config = team_runtime
    store.create(AgentRun(run_id="root", agent_id="director", skill_id="", operation="team", origin="chat", status="running", created_at=0, updated_at=0), scope, {}, snapshot.model_dump())
    monkeypatch.setattr(teams, "validate_temporary", lambda *_: None)
    spec = TemporaryAgentSpec(name="Specialist", instructions="Generic procedure", provider="local", model="cheap", skill_ids=snapshot.skill_ids, acceptance=["Evidence"])
    temporary = teams._temporary(spec, snapshot.profile, "root", scope)
    store.create(AgentRun(run_id="evidence", parent_run_id="root", agent_id=temporary["id"], skill_id="", operation="team", origin="chat", status="completed", created_at=0, updated_at=0), scope, {}, snapshot.model_dump())
    monkeypatch.setattr(teams, "_config", lambda: {"agents": []})
    teams._propose(scope, "root", temporary, "evidence")
    proposal = artifacts.list_artifacts(scope, "proposal", "root")[0]
    assert len(config["agents"]) == 2
    assert "Generic procedure" not in proposal["instructions"]
    assert proposal["verified_results"][0]["run_id"] == "evidence"
    assignments = SimpleNamespace(_lock=threading.RLock(), _refresh_if_changed=lambda: None, params={"ai": config}, save=lambda: None)
    monkeypatch.setattr(app_config, "load_params", lambda **_: SimpleNamespace(ai=config, params=assignments.params, params_source="test"))
    monkeypatch.setattr(agent_skill_assignments, "AgentSkillAssignmentStore", lambda *_: assignments)
    approved = artifacts.retain(scope, "root", proposal["id"], accept=True, instructions="Reviewed reusable procedure", add_to_team=add_to_team)
    permanent = assignments.params["ai"]["agents"][-1]
    assert permanent["id"] == approved["permanent_agent_id"]
    assert any(m["agent_id"] == permanent["id"] for m in config["agents"][0]["team"]["members"]) is add_to_team
    assert permanent["persona"] == "Reviewed reusable procedure"
    assert permanent["context"] == "" and permanent["context_refs"] == []
    assert "history" not in permanent and "memories" not in permanent
    assert artifacts.retain(scope, "root", proposal["id"], accept=True) == approved
    assert len(config["agents"]) == 3


@pytest.mark.parametrize("read_only,peak_expected", [(True, 2), (False, 1)])
def test_only_independent_readers_run_concurrently(team_runtime, monkeypatch, read_only, peak_expected):
    from backend.services import agent_team_runtime as teams
    _, snapshot, _, config = team_runtime
    snapshot.profile["team"]["direct_routes"] = []
    config["agents"][0]["team"] = snapshot.profile["team"]
    tasks = [{"id": f"t{i}", "agent_id": "worker", "objective": "Check", "skill_ids": snapshot.skill_ids, "read_only": read_only} for i in range(4)]
    config["_responses"] = {"director": [json.dumps({"tasks": tasks, "result_task": "t3"})]}
    active = 0
    peak = 0
    async def executor(*args, **kwargs):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.01)
        active -= 1
        return {"status": "completed", "result": '{"result":"done"}', "confirmations": []}
    monkeypatch.setattr(teams, "_execute_task", executor)
    run_operation(team_runtime)
    assert peak == peak_expected


def test_read_only_runtime_removes_mutating_tools():
    from backend.services.agent_team_runtime import _filter_runtime
    from backend.services.agent_skill_catalog import AgentRuntimeCapabilities
    descriptors = (SimpleNamespace(effects=["read"]), SimpleNamespace(effects=["external_write"]))
    runtime = AgentRuntimeCapabilities((), (), (), ("reader", "writer"), descriptors, (), (), (), "1")
    filtered = _filter_runtime(runtime, read_only=True)
    assert filtered.tools == ("reader",)
    assert runtime.tools == ("reader", "writer")


def test_resume_reuses_completed_director_synthesis(team_runtime):
    from backend.services import agent_execution_store as store
    from backend.services.agent_execution import resume_run
    from backend.services.agent_execution_scope import execution_scope
    scope, snapshot, calls, config = team_runtime
    snapshot.profile["team"]["direct_routes"] = []
    config["agents"][0]["team"] = snapshot.profile["team"]
    config["_responses"] = {"director": [json.dumps({"tasks": [{"id": "read", "agent_id": "worker", "objective": "Read", "skill_ids": snapshot.skill_ids}], "result_task": "read", "synthesize": True}), '{"result":"integrated"}']}
    run = run_operation(team_runtime, schema={"type": "object"})
    store.update(scope, run.run_id, status="interrupted")
    with execution_scope(scope):
        resumed = asyncio.run(resume_run(run.run_id))
    assert json.loads(resumed.result) == {"result": "integrated"}
    assert calls == ["director", "worker", "director"]
