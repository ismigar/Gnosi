"""Automatic quality review through the real governed executor with synthetic models."""
import asyncio
import json

import pytest
from pydantic import ValidationError

from backend.services import agent_execution_store as runs, agent_team_store as artifacts
from backend.services.agent_gauntlet_models import GauntletPlan, GauntletReview, improved
from backend.services.agent_gauntlet_policy import needs_planning, review_plan
from backend.services.agent_team_models import TeamPlan, TeamTask
from backend.tests.test_agent_team import run_operation, routine_help_plan, team_runtime, optional_runtime  # noqa: F401


def assessment(outcome="passed", *, severity="none", criterion="C1", evidence="Source says 7; candidate says 7."):
    return json.dumps({"checks": [{"criterion_id": criterion, "outcome": outcome, "severity": severity,
                                  "evidence": evidence, "issue": "Wrong value" if outcome == "failed" else ""}]})


def prepare(fixture, responses, *, read_only=True, direct_route=False):
    _, snapshot, _, config = fixture
    if not direct_route:
        snapshot.profile["team"]["direct_routes"] = []
    config["agents"][0]["team"] = snapshot.profile["team"]
    plan = {"tasks": [{"id": "draft", "agent_id": "worker", "objective": "Answer the original research question",
                       "skill_ids": [skill for skill in snapshot.skill_ids if skill != "core.gnosi-coordination"],
                       "read_only": read_only}], "result_task": "draft",
            "quality": {"mode": "elaborate", "reason": "Substantive source-grounded analysis",
                        "criteria": ["The final value must match the supplied source value 7."]}}
    config["_responses"] = {"director": [json.dumps(plan)], "worker": responses}


def test_automatic_elaborate_task_corrects_then_receives_fresh_review(team_runtime, monkeypatch):
    from backend.services import agent_execution
    captured = []
    execute = agent_execution.execute_operation

    async def capture(request, **kwargs):
        if request.operation.startswith("gauntlet."):
            captured.append(request.model_dump())
        return await execute(request, **kwargs)

    monkeypatch.setattr(agent_execution, "execute_operation", capture)
    prepare(team_runtime, ['{"value":9}', assessment("failed", severity="high", evidence="Source=7; candidate=9"),
                           '{"value":7}', assessment()])
    scope, _, calls, _ = team_runtime
    run = run_operation(team_runtime, schema={"type": "object", "properties": {"value": {"type": "number"}}, "required": ["value"]}, input_text="Source value is 7. Explain its significance.")
    assert json.loads(run.result) == {"value": 7}
    assert calls == ["director", "worker", "worker", "worker", "worker"]
    work = artifacts.list_artifacts(scope, "gauntlet", run.run_id)[0]
    assert work["status"] == "accepted" and work["rounds"] == 2
    assert len(artifacts.list_artifacts(scope, "task", run.run_id)) == 1
    children = [row for row in runs.list_runs(scope) if row.operation.startswith("gauntlet.")]
    assert len(children) == 3 and len({row.run_id for row in children}) == 3
    private_review = next(row for row in children if row.operation == "gauntlet.review")
    assert all(runs.read(scope, row.run_id).result == "" for row in children)
    with runs.connect() as db:
        stored = [db.execute("SELECT request,snapshot FROM agent_runs WHERE run_id=?", (row.run_id,)).fetchone() for row in children]
        assert all(not runs._saved_snapshot(db, row) for row in stored)
    assert all(json.loads(row[0])["resume_requires_parent"] and "input" not in json.loads(row[0]) for row in stored)
    assert all("review" not in phase for phase in work["phases"])
    requests = captured
    reviews = [request for request in requests if request["operation"] == "gauntlet.review"]
    assert all(request["tool_mode"] == "none" and request["max_model_calls"] == 1 and request["resume_requires_parent"] for request in requests)
    packets = [json.loads(request["input"]) for request in reviews]
    assert all("findings" not in packet for packet in packets)
    assert {json.loads(packet["candidate"])["value"] for packet in packets} == {9, 7}
    assert all(packet["criteria"] == work["criteria"] for packet in packets)
    from backend.services.agent_execution_trace import events
    trace = json.dumps(events(scope, run.run_id), ensure_ascii=False)
    assert "The final value must match" not in trace
    assert "Source=7; candidate=9" not in trace
    assert '"criteria"' not in trace and '"review"' not in trace
    review_trace = json.dumps(events(scope, private_review.run_id), ensure_ascii=False)
    assert "The final value must match" not in review_trace
    assert "Source=7; candidate=9" not in review_trace
    assert '"metadata_only": true' in review_trace


def test_simple_text_transform_is_classified_without_adding_reviews(optional_runtime):
    from backend.tests.test_principal_agent_routing import run_chat
    fixture, _ = optional_runtime
    routine_help_plan(fixture)
    run_chat(fixture, "Summarize: one sentence")
    assert fixture[2] == ["director", "worker"]
    assert artifacts.list_artifacts(fixture[0], "gauntlet") == []


def test_routine_task_cannot_inherit_a_workers_review_claim(optional_runtime):
    from backend.tests.test_principal_agent_routing import run_chat
    from langchain_core.messages import AIMessage
    fixture, _ = optional_runtime
    routine_help_plan(fixture)
    fixture[3]["_responses"] = {"worker": [AIMessage(content="A short summary", additional_kwargs={
        "gnosi_gauntlet": {"status": "accepted", "rounds": 1, "finding_count": 0, "stop_reason": "accepted"}})]}
    messages, _ = run_chat(fixture, "Summarize: one sentence")
    assert "gnosi_gauntlet" not in messages[-1].additional_kwargs
    assert fixture[2] == ["director", "worker"] and artifacts.list_artifacts(fixture[0], "gauntlet") == []


def test_short_inline_competing_sources_are_planned_and_reviewed(optional_runtime):
    from backend.tests.test_principal_agent_routing import run_chat
    from langchain_core.messages import AIMessage
    fixture, _ = optional_runtime
    prepare(fixture, [], direct_route=True)
    plan = TeamPlan.model_validate_json(fixture[3]["_responses"]["director"][0])
    plan.quality.criteria = ["Reconcile the pricing and distribution explanations using both original sources."]
    fixture[3]["_phase_responses"] = {"team.plan": [AIMessage(content=plan.model_dump_json())],
        "gauntlet.review": [AIMessage(content=assessment(evidence="The report covers both supplied explanations without inventing a resolution."))]}
    fixture[3]["_responses"] = {"worker": [AIMessage(content="Source A cites pricing; Source B cites distribution. Both may contribute; the supplied evidence cannot distinguish their relative impact.")]}
    request = ("Summarize: Source A attributes the sales decline to pricing. Source B attributes it to distribution. "
               "Compare the competing explanations, reconcile the evidence, and write a substantive report.")
    messages, _ = run_chat(fixture, request)
    assert fixture[2] == ["director", "worker", "worker"]
    assert messages[-1].additional_kwargs["gnosi_gauntlet"]["status"] == "accepted"
    saved = artifacts.list_artifacts(fixture[0], "plan")[0]
    work = artifacts.list_artifacts(fixture[0], "gauntlet")[0]
    assert saved["plan"]["quality"]["mode"] == "elaborate"
    assert [item["requirement"] for item in work["criteria"]] == plan.quality.criteria


def test_elaborate_output_cannot_seed_a_routine_style_continuation(optional_runtime):
    from backend.tests.test_principal_agent_routing import run_chat
    from langchain_core.messages import AIMessage, HumanMessage
    fixture, _ = optional_runtime
    prepare(fixture, [], direct_route=True)
    plan = TeamPlan.model_validate_json(fixture[3]["_responses"]["director"][0])
    fixture[3]["_phase_responses"] = {"team.plan": [AIMessage(content=plan.model_dump_json())],
        "gauntlet.review": [AIMessage(content=assessment())]}
    fixture[3]["_responses"] = {"worker": [AIMessage(content="Detailed report on the source value 7.")]}
    original = "Summarize: explain the source value 7 in a substantive report."
    messages, _ = run_chat(fixture, original)
    assert "gnosi_team_route" not in messages[-1].additional_kwargs
    plan.quality = GauntletPlan()
    fixture[3]["_phase_responses"]["team.plan"] = [AIMessage(content=plan.model_dump_json())]
    fixture[3]["_responses"] = {"worker": [AIMessage(content="Shorter report.")]}
    revised, _ = run_chat(fixture, "Now make it shorter.", history=[HumanMessage(content=original), messages[-1]])
    assert fixture[2] == ["director", "worker", "worker", "director", "worker"]
    assert revised[-1].additional_kwargs["gnosi_team_usage"]["routing"]["mode"] == "director"


@pytest.mark.parametrize("key_syntax", ['summary', '"summary"', "'summary'", '`summary`'])
@pytest.mark.parametrize("weakened", [None, "optional", "extra", "wrong"])
def test_short_chat_json_transform_gets_quality_planning_and_strict_output(optional_runtime, monkeypatch, weakened, key_syntax):
    from backend.domains.agent import workflow
    from backend.tests.test_principal_agent_routing import run_chat
    from langchain_core.messages import AIMessage
    fixture, _ = optional_runtime
    prepare(fixture, [], direct_route=True)
    plan = json.loads(fixture[3]["_responses"]["director"][0])
    plan.update(operation="writing", output_contract={"type": "object", "fields": [
        {"path": ["summary"], "type": "string", "required": True}], "allow_extra_keys": False})
    plan = TeamPlan.model_validate(plan).model_dump()
    responses = [AIMessage(content=json.dumps(plan))]
    if weakened:
        from copy import deepcopy
        invalid = deepcopy(plan)
        if weakened == "optional":
            invalid["output_contract"]["fields"][0]["required"] = False
        elif weakened == "wrong":
            invalid["output_contract"]["fields"][0]["path"] = ["wrong"]
        else:
            invalid["output_contract"]["allow_extra_keys"] = True
        responses.insert(0, AIMessage(content=json.dumps(invalid)))
    fixture[3]["_responses"] = {"director": responses,
        "worker": [AIMessage(content='{"summary":"Source value is 7."}'), AIMessage(content=assessment())]}
    resolve = workflow.resolve_model
    models = {}

    def shared_model(profile, **kwargs):
        identifier = profile.agent_data["id"]
        if identifier not in models:
            models[identifier] = resolve(profile, **kwargs)
        return models[identifier]

    monkeypatch.setattr(workflow, "resolve_model", shared_model)
    messages, _ = run_chat(fixture, "Summarize: this document and return exactly JSON with key " + key_syntax,
                           refs=[{"id": "report", "type": "page", "ref": "report"}])
    assert fixture[2] == ["director"] * (2 if weakened else 1) + ["worker", "worker"]
    assert json.loads(messages[-1].content) == {"summary": "Source value is 7."}
    assert messages[-1].additional_kwargs["gnosi_gauntlet"]["status"] == "accepted"
    assert messages[-1].additional_kwargs["gnosi_team_output"]["status"] == "validated"
    saved = artifacts.list_artifacts(fixture[0], "plan")[0]["plan"]
    assert saved["quality"]["mode"] == "elaborate" and saved["output_contract"]["fields"][0]["path"] == ["summary"]


def test_short_operation_with_a_direct_route_gets_planned_and_reviewed(team_runtime):
    prepare(team_runtime, ["candidate", assessment()], direct_route=True)
    run = run_operation(team_runtime, input_text="Research and explain the supplied data")
    work = artifacts.list_artifacts(team_runtime[0], "gauntlet", run.run_id)[0]
    assert work["status"] == "accepted" and work["rounds"] == 1
    assert team_runtime[2] == ["director", "worker", "worker"]


def test_two_corrections_without_progress_stop_with_latest_candidate(team_runtime):
    fail = assessment("failed", severity="medium")
    prepare(team_runtime, ["draft", fail, "revision one", fail, "revision two", fail])
    run = run_operation(team_runtime, input_text="Research and explain the source value 7")
    work = artifacts.list_artifacts(team_runtime[0], "gauntlet", run.run_id)[0]
    assert work["status"] == "stagnated" and work["stagnant_rounds"] == 2 and work["rounds"] == 3
    assert run.result == "revision two"
    assert len(team_runtime[2]) == 7


@pytest.mark.parametrize("response,reason", [
    ("invalid", "invalid_review"),
    (assessment(criterion="C2"), "invalid_review"),
    (assessment("unverifiable", evidence="Original source passage is missing."), "unverified_evidence"),
])
def test_missing_or_invalid_verification_never_accepts(team_runtime, response, reason):
    prepare(team_runtime, ["candidate", response])
    run = run_operation(team_runtime)
    work = artifacts.list_artifacts(team_runtime[0], "gauntlet", run.run_id)[0]
    assert work["status"] == "incomplete" and work["stop_reason"] == reason
    assert run.result == "candidate" and len(team_runtime[2]) == 3


def test_completed_action_failure_needs_review_without_confirmation_or_replay(team_runtime):
    from backend.services import agent_team_runtime as teams
    from backend.services.agent_execution_models import AgentRun
    from backend.services.agent_execution_scope import execution_scope
    from backend.services.agent_gauntlet import review_team_result
    scope, snapshot, calls, config = team_runtime
    prepare(team_runtime, [assessment("failed", severity="high", evidence="Completed action receipt has value 9, required value is 7")], read_only=False)
    plan = TeamPlan.model_validate_json(config["_responses"]["director"][0])
    runs.create(AgentRun(run_id="root", agent_id="director", skill_id="", operation="team", origin="chat",
                        status="running", created_at=0, updated_at=0), scope, {}, snapshot.model_dump())
    worker, _ = teams._snapshot(config["agents"][1], snapshot.profile, "root", scope, snapshot.skill_ids, [])
    receipt = '{"status":"completed","value":9}'
    results = {"draft": {"status": "completed", "result": receipt, "confirmations": [],
                         "snapshot": worker.model_dump(), "action_evidence": [{"status": "completed", "value": 9}]}}
    with execution_scope(scope):
        result, metadata = asyncio.run(review_team_result(root_id="root", scope=scope, plan=plan,
            original="Set the value to 7", state={}, results=results, candidate=receipt,
            output_schema=None, metadata={}, operation_mode=False))
    assert result == receipt and calls == ["worker"]
    assert metadata["gnosi_gauntlet"] == {"status": "incomplete", "rounds": 1, "finding_count": 1,
                                         "stop_reason": "action_review"}
    assert "gnosi_action_confirmation" not in metadata
    assert [row.operation for row in runs.list_runs(scope) if row.parent_run_id == "root"] == ["gauntlet.review"]
    assert len(artifacts.list_artifacts(scope, "gauntlet", "root")[0]["phases"]) == 1


def test_shared_parent_budget_stops_improving_loop_without_acceptance(team_runtime):
    prepare(team_runtime, ["initial", assessment("failed", severity="critical"), "r1",
        assessment("failed", severity="high"), "r2", assessment("failed", severity="medium"), "r3"])
    run = run_operation(team_runtime)
    scope = team_runtime[0]
    work = artifacts.list_artifacts(scope, "gauntlet", run.run_id)[0]
    assert work["status"] == "incomplete" and work["stop_reason"] == "budget"
    children = [row for row in runs.list_runs(scope) if row.parent_run_id == run.run_id]
    assert sum(row.model_calls for row in children) == 8
    assert work["rounds"] == 3 and run.result == "r3"


def test_fixed_criterion_identity_prevents_renaming_progress():
    before = GauntletReview.model_validate_json(assessment("failed", severity="high"))
    renamed = before.model_copy(deep=True)
    renamed.checks[0].issue = "A newly named defect"
    assert not improved(before, renamed)
    lower = before.model_copy(deep=True)
    lower.checks[0].severity = "medium"
    assert improved(before, lower)
    assert not improved(lower, before)


def test_coverage_requires_every_original_criterion_exactly_once():
    review = GauntletReview.model_validate_json(assessment())
    with pytest.raises(ValueError, match="criteria"):
        review.validate_coverage([{"id": "C1"}, {"id": "C2"}])
    duplicate = review.model_copy(update={"checks": review.checks * 2})
    with pytest.raises(ValueError, match="criteria"):
        duplicate.validate_coverage([{"id": "C1"}])
    with pytest.raises(ValidationError):
        GauntletPlan(mode="elaborate", reason="Analysis", criteria=[])
    with pytest.raises(ValidationError):
        GauntletPlan(mode="elaborate", reason="Analysis", criteria=["x" * 4097])
    contradictory = json.loads(assessment())
    contradictory["checks"][0]["issue"] = "contradictory finding"
    with pytest.raises(ValidationError, match="invalid_issue"):
        GauntletReview.model_validate(contradictory)


def test_new_planner_quality_requires_an_explicit_classification():
    from jsonschema import Draft202012Validator
    validator = Draft202012Validator(GauntletPlan.model_json_schema())
    assert not validator.is_valid({})
    assert not validator.is_valid({"criteria": ["Satisfy the requested source constraints"]})
    assert validator.is_valid({"mode": "routine"})
    # Cached pre-feature plans retain their default without certifying a review.
    assert GauntletPlan.model_validate({}).mode == "routine"


def test_private_phase_inputs_never_persist_after_worker_crash(team_runtime, tmp_path):
    import subprocess
    import sys
    import time
    import textwrap
    from pathlib import Path
    from backend.services.agent_execution_models import AgentRun
    scope, snapshot, _, _ = team_runtime
    runs.create(AgentRun(run_id="root", agent_id="director", skill_id="", operation="team", origin="chat", status="running", created_at=0, updated_at=0),
                scope, {}, snapshot.model_dump())
    ready = tmp_path / "worker-ready"
    script = tmp_path / "private-worker.py"
    script.write_text(textwrap.dedent('''
        import asyncio, sys
        from pathlib import Path
        sys.path.insert(0, sys.argv[4])
        from backend.services import agent_execution as execution, agent_execution_store as store
        from backend.services.agent_execution_models import AgentExecutionSnapshot, AgentOperation, ExecutionScope
        from backend.services.agent_execution_scope import execution_scope
        store.resolve_data_dir = lambda **_: Path(sys.argv[1])
        execution.revalidate_scope = lambda _: None
        execution._operation_context = lambda request, snapshot: (snapshot, {}, None)
        scope = ExecutionScope.model_validate_json(sys.argv[2])
        snapshot = AgentExecutionSnapshot(scope=scope, agent_id="worker", skill_ids=["synthetic"], instructions=[],
            profile={"id":"worker", "context":"PRIVATE-CRITIC-MATERIAL"}, catalog_revision="1", revision="1")
        async def block(*args, **kwargs):
            Path(sys.argv[3]).write_text(execution._run.get())
            await asyncio.sleep(60)
        execution._operation_application = block
        request = AgentOperation(skill_id="synthetic", operation="gauntlet.revise", input="PRIVATE-CRITIC-MATERIAL",
            max_model_calls=1, tool_mode="none", parent_run_id="root", resume_requires_parent=True)
        with execution_scope(scope):
            asyncio.run(execution.execute_operation(request, snapshot=snapshot, private_result=True))
    '''))
    process = subprocess.Popen([sys.executable, str(script), str(tmp_path), scope.model_dump_json(), str(ready), str(Path(__file__).resolve().parents[2])],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 10
        while not ready.exists() and time.monotonic() < deadline and process.poll() is None:
            time.sleep(0.05)
        assert ready.exists(), process.communicate(timeout=1) if process.poll() is not None else "worker did not become ready"
        child_id = ready.read_text()
        with runs.connect() as db:
            row = runs._row(db, scope, child_id)
            request, saved_snapshot = json.loads(row["request"]), runs._saved_snapshot(db, row)
            assert request["resume_requires_parent"] and "input" not in request and saved_snapshot == {}
            durable = str(db.execute("SELECT request,snapshot,payload FROM agent_runs").fetchall())
            durable += str([row[0] for row in db.execute("SELECT payload FROM agent_run_snapshots")])
        assert "PRIVATE-CRITIC-MATERIAL" not in durable
        process.terminate()  # Disposable owned worker; SIGTERM bypasses Python finally.
        process.wait(timeout=10)
        interrupted = runs.read(scope, child_id)
        assert interrupted.status == "interrupted" and not interrupted.resumable
        with runs.connect() as db:
            assert "input" not in json.loads(runs._row(db, scope, child_id)["request"])
        with pytest.raises(ValueError, match="original_entrypoint"):
            runs.resume_data(scope, child_id)
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=10)
        if process.stdout:
            process.stdout.close()
        if process.stderr:
            process.stderr.close()


def test_composed_work_has_review_floor_and_large_input_cannot_bypass_planning():
    from langchain_core.messages import HumanMessage
    task = TeamTask(id="one", agent_id="worker", objective="Read", skill_ids=["read"], acceptance=["Use original quotations"])
    plan = TeamPlan(tasks=[task], result_task="one", synthesize=True)
    assert review_plan(plan).mode == "elaborate"
    assert review_plan(plan).criteria == ["Use original quotations"]
    direct_response = TeamPlan(response="A substantive response", quality=GauntletPlan(
        mode="elaborate", reason="Analysis", criteria=["Address the competing explanations"]))
    assert review_plan(direct_response).mode == "elaborate"
    assert needs_planning("Summarize: sentence", [], {})
    assert not needs_planning("Now make it shorter.", [], {})
    assert needs_planning("Summarize: sentence and return exactly JSON with key summary", [], {})
    assert needs_planning("Summarize: report", [{"id": "report"}], {})
    assert needs_planning("Summarize: report", [], {"messages": [HumanMessage(content="Summarize: report\nAttached report text")]})
    assert needs_planning("make it shorter", [], {"messages": [HumanMessage(content=[
        {"type": "text", "text": "make it shorter"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,synthetic"}}])]})
    assert needs_planning("Summarize: sentence, output JSON", [], {})
    assert needs_planning('{"operation":"writing.correct"}', [], {}, operation_mode=True)
    assert needs_planning("Summarize: " + "source " * 400, [], {})
    assert needs_planning("Summarize", [{"id": "a"}, {"id": "b"}], {})


def test_many_task_criteria_are_grouped_without_losing_the_original_contract():
    tasks = [TeamTask(id=f"t{task}", agent_id="worker", objective="Read", skill_ids=["read"],
        acceptance=[f"criterion-{task}-{item}: " + "x" * 980 for item in range(8)]) for task in range(4)]
    quality = review_plan(TeamPlan(tasks=tasks, result_task="t0", synthesize=True))
    assert quality.mode == "elaborate" and len(quality.criteria) == 8
    assert all(len(item) <= 4096 for item in quality.criteria)
    assert all(f"criterion-{task}-{item}:" in "\n".join(quality.criteria) for task in range(4) for item in range(8))


def test_source_evidence_is_bounded_and_marks_omissions():
    from backend.services.agent_team_runtime import _add_review_evidence
    outcome = {"review_evidence": []}
    _add_review_evidence(outcome, {"tool": "read_record", "status": "success", "content": "x" * 10000})
    assert outcome["review_evidence"][0]["truncated"] is True
    assert len(outcome["review_evidence"][0]["content_excerpt"]) <= 3600
    for _ in range(12):
        _add_review_evidence(outcome, {"tool": "read_record", "status": "success", "content": "x"})
    assert len(outcome["review_evidence"]) == 12 and outcome["review_evidence_omitted"] == 1


def test_original_context_is_bounded_and_reports_omissions():
    from langchain_core.messages import HumanMessage
    from backend.services.agent_gauntlet import _packet
    packet = _packet("Complete the original request", {"messages": [HumanMessage(content="x" * 5000) for _ in range(10)]}, {}, [], None)
    assert packet["omitted_context_messages"] == 2 and len(packet["original_context"]) == 8
    assert all(item["truncated"] and len(item["content"]) == 4000 for item in packet["original_context"])


def test_interrupted_review_is_incomplete_after_restart_without_replaying_calls(team_runtime, monkeypatch):
    from backend.services.agent_gauntlet import review_deliverable
    from backend.services.agent_execution_models import AgentRun
    from backend.services import agent_gauntlet
    scope, snapshot, _, _ = team_runtime
    runs.create(AgentRun(run_id="root", agent_id="director", skill_id="", operation="team", origin="chat", status="running", created_at=0, updated_at=0),
                scope, {}, snapshot.model_dump())
    calls = []

    async def interrupt(*args, **kwargs):
        calls.append(True)
        raise asyncio.CancelledError

    monkeypatch.setattr(agent_gauntlet, "_call", interrupt)
    kwargs = dict(root_id="root", scope=scope, quality=GauntletPlan(mode="elaborate", reason="Analysis", criteria=["Verify the supplied value"]),
                  source=snapshot, original="Explain the supplied value", state={}, results={}, candidate="candidate", output_schema=None)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(review_deliverable(**kwargs))
    result, summary = asyncio.run(review_deliverable(**kwargs))
    assert result == "candidate" and summary["status"] == "incomplete" and summary["stop_reason"] == "interrupted"
    assert calls == [True]


def test_fresh_snapshot_keeps_authority_but_excludes_private_context(team_runtime):
    from backend.services.agent_gauntlet import _fresh_snapshot
    snapshot = team_runtime[1]
    snapshot.profile.update(persona="Builder persona", context="Builder history", _execution_detailed_persona="Builder detailed", _execution_reviewed_memory=[{"text": "Builder preference"}])
    critic = _fresh_snapshot(snapshot, "review", "root")
    assert critic.scope == snapshot.scope and critic.skill_ids == snapshot.skill_ids
    assert critic.profile["context"] == "" and critic.profile["persona"] == ""
    assert critic.profile["_execution_reviewed_memory"] == [] and critic.profile["team"] == {"enabled": False}
    assert snapshot.profile["context"] == "Builder history"
    assert critic.parent_run_id == "root"
    assert critic.profile["_team_execution"] == {"root_id": "root", "owner_id": snapshot.agent_id, "read_only": True}


def test_root_review_cannot_accept_after_team_authority_is_revoked(team_runtime, monkeypatch):
    from backend.services import agent_gauntlet
    from backend.services.agent_execution_models import AgentRun
    scope, snapshot, _, config = team_runtime
    runs.create(AgentRun(run_id="root", agent_id="director", skill_id="", operation="team", origin="chat", status="running", created_at=0, updated_at=0),
                scope, {}, snapshot.model_dump())

    async def revoke(*args, **kwargs):
        config["agents"][0]["team"]["enabled"] = False
        return assessment(), "review-run"

    monkeypatch.setattr(agent_gauntlet, "_call", revoke)
    with pytest.raises(PermissionError, match="agent_team_revoked"):
        asyncio.run(agent_gauntlet.review_deliverable(root_id="root", scope=scope,
            quality=GauntletPlan(mode="elaborate", reason="Analysis", criteria=["Verify the supplied value"]),
            source=snapshot, original="Explain the supplied value", state={}, results={}, candidate="candidate", output_schema=None))
    assert artifacts.list_artifacts(scope, "gauntlet", "root")[0]["status"] != "accepted"


def test_cancellation_interrupts_child_and_does_not_become_incomplete(team_runtime, monkeypatch):
    from backend.services import agent_execution
    from backend.services.agent_gauntlet import _call
    from backend.services.agent_cancellation import AgentTurnCancelled, cancel, create_cancel_token, release
    token = create_cancel_token()
    ended = []

    async def child(*args, **kwargs):
        try:
            await asyncio.sleep(10)
        finally:
            ended.append(True)

    monkeypatch.setattr(agent_execution, "execute_operation", child)

    async def scenario():
        pending = asyncio.create_task(_call(team_runtime[1], "review", "root", {}, "candidate", 1, token, 10, None))
        await asyncio.sleep(0.02)
        cancel(token)
        with pytest.raises(AgentTurnCancelled):
            await pending

    try:
        asyncio.run(scenario())
        assert ended == [True]
    finally:
        release(token)
