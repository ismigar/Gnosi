"""Cross-run source phases reuse only current, authorized, validated outputs."""
from copy import deepcopy
import json

import pytest

from backend.services import agent_execution as execution, agent_execution_store as store
from backend.services.agent_execution_models import AgentOperation
from backend.services.agent_execution_scope import execution_scope
from backend.services.reading_result_cache import result_key
from backend.tests.test_agent_execution import install_workflow, runtime as runtime


def request(snapshot, **changes):
    values = dict(skill_id=snapshot.skill_ids[0], operation="knowledge.process-source.phase", input="All originals and caveats.",
                  output_schema={"type": "object", "required": ["answer"]}, resume_requires_parent=True)
    return AgentOperation(**(values | changes))


def test_validated_phase_reused_in_new_job_with_zero_new_model_calls(runtime, monkeypatch):
    scope, snapshot = runtime
    calls = install_workflow(monkeypatch, ['{"answer":"Faithful interpretation."}'])
    checked = []
    def validate(text):
        checked.append(text)
        return text
    with execution_scope(scope):
        first_job = execution.create_job_run(snapshot, "first-book-job", "knowledge.process-source")
        first = execution.run_sync(request(snapshot), snapshot=first_job, output_validator=validate)
        second_job = execution.create_job_run(snapshot, "second-book-job", "knowledge.process-source")
        second = execution.run_sync(request(snapshot), snapshot=second_job, output_validator=validate)
    assert len(calls) == 1 and len(checked) == 2
    assert first.result == second.result and first.run_id != second.run_id
    assert second.parent_run_id == "second-book-job"
    assert second.status == "completed" and second.model_calls == second.input_tokens == second.output_tokens == 0


@pytest.mark.parametrize("change", ["user", "vault", "workspace", "role", "model", "reasoning", "instructions", "policy", "originals", "schema"])
def test_result_identity_invalidates_each_scope_configuration_and_content_boundary(runtime, change):
    scope, snapshot = runtime
    original = result_key(request(snapshot), snapshot)
    changed = deepcopy(snapshot)
    req = request(snapshot)
    if change in {"user", "vault", "workspace", "role"}:
        field = {"user": "user_id", "vault": "vault_path", "workspace": "workspace_id", "role": "role"}[change]
        changed.scope = scope.model_copy(update={field: "editor" if change == "role" else "different"})
    elif change in {"model", "reasoning"}:
        changed.profile["model" if change == "model" else "reasoning_effort"] = "different"
    elif change == "instructions":
        changed.instructions = ["Changed reading policy"]
    elif change == "policy":
        changed.behavior_resources = {"system/data-boundary.md": "Changed"}
    elif change == "originals":
        req.input += " Another source."
    else:
        req.output_schema = {"type": "object", "required": ["different"]}
    assert result_key(req, changed) != original


def test_force_refresh_bypasses_reuse_and_refreshes_future_result(runtime, monkeypatch):
    scope, snapshot = runtime
    calls = install_workflow(monkeypatch, ['{"answer":"first"}', '{"answer":"fresh"}'])
    with execution_scope(scope):
        execution.run_sync(request(snapshot), snapshot=snapshot)
        fresh = execution.run_sync(request(snapshot, options={"reading_result_cache": False}), snapshot=snapshot)
        reused = execution.run_sync(request(snapshot), snapshot=snapshot)
    assert len(calls) == 2 and fresh.result == reused.result
    assert json.loads(reused.result) == {"answer": "fresh"}


@pytest.mark.parametrize("field", ["user_id", "workspace_id", "vault_path"])
def test_storage_lookup_enforces_scope_even_with_a_known_cache_key(runtime, monkeypatch, field):
    from backend.services.reading_result_cache import lookup
    scope, snapshot = runtime
    install_workflow(monkeypatch, ['{"answer":"private"}'])
    req = request(snapshot)
    with execution_scope(scope):
        execution.run_sync(req, snapshot=snapshot)
    other = snapshot.model_copy(update={"scope": scope.model_copy(update={field: "unrelated"})})
    assert lookup(req, other, result_key(req, snapshot), "test", "fake") is None


def test_only_completed_non_cancelled_same_model_reading_results_are_reused(runtime, monkeypatch):
    from backend.services.reading_result_cache import lookup
    scope, snapshot = runtime
    install_workflow(monkeypatch, ['{"answer":"faithful"}'])
    req = request(snapshot)
    with execution_scope(scope):
        first = execution.run_sync(req, snapshot=snapshot)
    key = result_key(req, snapshot)
    assert lookup(req, snapshot, key, "other", "fake") is None
    assert lookup(req, snapshot, key, "test", "other-model") is None
    assert not result_key(req.model_copy(update={"operation": "writing"}), snapshot)
    assert not result_key(req.model_copy(update={"tool_mode": "read"}), snapshot)
    with store.connect() as db:
        db.execute("UPDATE agent_runs SET cancelled=1 WHERE run_id=?", (first.run_id,))
    assert lookup(req, snapshot, key, "test", "fake") is None


def test_reuse_revalidates_output_and_permissions_before_returning(runtime, monkeypatch):
    scope, snapshot = runtime
    calls = install_workflow(monkeypatch, ['{"answer":"first"}', '{"answer":"corrected"}'])
    with execution_scope(scope):
        first = execution.run_sync(request(snapshot), snapshot=snapshot)
        with store.connect() as db:
            damaged = first.model_copy(update={"result": '{"wrong":"schema"}'})
            db.execute("UPDATE agent_runs SET payload=? WHERE run_id=?", (damaged.model_dump_json(), first.run_id))
        corrected = execution.run_sync(request(snapshot), snapshot=snapshot)
        assert json.loads(corrected.result)["answer"] == "corrected"
        def revoked(_):
            raise PermissionError("revoked")
        monkeypatch.setattr(execution, "revalidate_scope", revoked)
        with pytest.raises(PermissionError, match="revoked"):
            execution.run_sync(request(snapshot), snapshot=snapshot)
    assert len(calls) == 2


def test_legacy_malformed_record_does_not_break_cache_index_or_reading(runtime, monkeypatch):
    scope, snapshot = runtime
    calls = install_workflow(monkeypatch, ['{"answer":"valid"}'])
    with store.connect() as db:
        db.execute("INSERT INTO agent_runs VALUES (?,?,?,?,?,?,?,?)",
                   ("legacy", scope.user_id, scope.workspace_id, scope.vault_path, "invalid", "{bad", "{}", 0))
        db.execute("DROP INDEX agent_runs_reading_result_cache")
    with execution_scope(scope):
        first = execution.run_sync(request(snapshot), snapshot=snapshot)
        cached = execution.run_sync(request(snapshot), snapshot=snapshot)
    assert first.result == cached.result and len(calls) == 1
