"""Tests for durable governed capability automations."""
from __future__ import annotations

import asyncio

import pytest

from backend.services import capability_automations


@pytest.fixture(autouse=True)
def isolated_automation_runtime(tmp_path, monkeypatch):
    """Keep the real configuration/SQLite path inside this test's probe."""
    for child in ("data", "vault", "host"):
        (tmp_path / child).mkdir()
    monkeypatch.setenv("GNOSI_VALIDATION_ROOT", str(tmp_path))
    for name, child in (
        ("GNOSI_DATA_DIR", "data"), ("DIGITAL_BRAIN_VAULT_PATH", "vault"),
        ("VAULT_HOST_PATH", "vault"), ("HOME_HOST_PATH", "host"),
    ):
        monkeypatch.setenv(name, str(tmp_path / child))


def _scope(**overrides):
    scope = {
        "vault_scope": "vault-a",
        "workspace_id": "workspace-a",
        "user_id": "user-a",
        "role": "owner",
    }
    scope.update(overrides)
    return scope


def _payload(**overrides):
    payload = {
        "name": "Daily briefing",
        "agent_id": "brain",
        "skill_id": "core.gnosi-daily-briefing",
        "instruction": "Prepare the private daily briefing.",
        "interval_minutes": 1_440,
        "enabled": True,
        "max_runs_per_day": 2,
        "max_ai_calls_per_run": 3,
        "max_runtime_seconds": 60,
    }
    payload.update(overrides)
    return payload


def test_automation_crud_is_revision_and_scope_bound(tmp_path, monkeypatch):
    created = capability_automations.save_automation(
        _scope(), vault_path=tmp_path / "vault", payload=_payload()
    )
    assert created["enabled"] is True
    assert created["budgets"]["max_ai_calls_per_run"] == 3
    assert capability_automations.list_automations(_scope())[0]["id"] == created["id"]
    assert capability_automations.list_automations(_scope(user_id="other")) == []

    updated = capability_automations.save_automation(
        _scope(),
        vault_path=tmp_path / "vault",
        payload=_payload(name="Morning briefing"),
        automation_id=created["id"],
        expected_revision=created["revision"],
    )
    assert updated["name"] == "Morning briefing"
    with pytest.raises(capability_automations.AutomationConflictError):
        capability_automations.save_automation(
            _scope(),
            vault_path=tmp_path / "vault",
            payload=_payload(name="Stale update"),
            automation_id=created["id"],
            expected_revision=created["revision"],
        )


def test_daily_budget_blocks_additional_runs(tmp_path, monkeypatch):
    created = capability_automations.save_automation(
        _scope(),
        vault_path=tmp_path / "vault",
        payload=_payload(max_runs_per_day=1),
    )
    row = capability_automations._load_for_run(created["id"])
    first = capability_automations._reserve_run(row, manual=True)
    assert first
    with capability_automations._database_connection() as connection:
        connection.execute(
            """
            UPDATE capability_automation_runs
            SET status='completed', finished_at=started_at WHERE id=?
            """,
            (first,),
        )
    with pytest.raises(RuntimeError, match="budget exhausted"):
        capability_automations._reserve_run(row, manual=True)


def test_active_run_blocks_overlap_and_stale_run_is_recovered(tmp_path, monkeypatch):
    created = capability_automations.save_automation(
        _scope(), vault_path=tmp_path / "vault", payload=_payload()
    )
    row = capability_automations._load_for_run(created["id"])
    first_id = capability_automations._reserve_run(row, manual=True)
    with pytest.raises(RuntimeError, match="active run"):
        capability_automations._reserve_run(row, manual=True)

    with capability_automations._database_connection() as connection:
        connection.execute(
            "UPDATE capability_automation_runs SET started_at = 0 WHERE id = ?",
            (first_id,),
        )
    second_id = capability_automations._reserve_run(row, manual=True)
    assert second_id != first_id
    with capability_automations._database_connection() as connection:
        recovered = connection.execute(
            "SELECT status, error_code FROM capability_automation_runs WHERE id = ?",
            (first_id,),
        ).fetchone()
    assert dict(recovered) == {
        "status": "failed", "error_code": "stale_run_recovered",
    }


def test_due_runner_is_bounded_to_ten(tmp_path, monkeypatch):
    ids = []
    for index in range(12):
        item = capability_automations.save_automation(
            _scope(),
            vault_path=tmp_path / "vault",
            payload=_payload(name=f"Automation {index}"),
        )
        ids.append(item["id"])
    with capability_automations._database_connection() as connection:
        connection.execute(
            "UPDATE capability_automations SET next_run_at = 0"
        )

    called = []

    async def fake_run(automation_id, *, manual=False):
        called.append((automation_id, manual))
        return {"automation_id": automation_id, "status": "completed"}

    monkeypatch.setattr(capability_automations, "run_automation", fake_run)
    result = asyncio.run(capability_automations.run_due_automations())
    assert result["due_count"] == 10
    assert len(called) == 10
    assert all(manual is False for _, manual in called)


def test_calendar_schedule_survives_legacy_edits_without_moving_next_run(tmp_path):
    created = capability_automations.save_automation(
        _scope(), vault_path=tmp_path / "vault",
        payload=_payload(schedule={"kind": "weekly", "time": "08:00", "timezone": "Europe/Madrid", "weekdays": [0, 4]}),
    )
    updated = capability_automations.save_automation(
        _scope(), vault_path=tmp_path / "vault", payload=_payload(name="Renamed"),
        automation_id=created["id"], expected_revision=created["revision"],
    )
    assert updated["schedule"] == created["schedule"]
    assert updated["next_run_at"] == created["next_run_at"]


def test_history_scopes_and_pagination(tmp_path):
    from backend.services.automation_history import list_scoped_runs

    created = []
    for scope in (_scope(), _scope(), _scope(user_id="other"), _scope(vault_scope="other"), _scope(workspace_id="other")):
        item = capability_automations.save_automation(scope, vault_path=tmp_path / "vault", payload=_payload())
        created.append(item)
        capability_automations._reserve_run(capability_automations._load_for_run(item["id"]), manual=True)
    first = list_scoped_runs(_scope(), limit=1, offset=0)
    second = list_scoped_runs(_scope(), limit=1, offset=1)
    assert first["total"] == second["total"] == 2
    assert first["runs"][0]["id"] != second["runs"][0]["id"]
    assert list_scoped_runs(_scope(), limit=50, offset=0, automation_id=created[-1]["id"])["runs"] == []


def test_calendar_migration_preserves_existing_schedule_and_runs(tmp_path):
    import sqlite3
    from backend.migrations.runner import _run_alembic

    database = tmp_path / "legacy.sqlite"
    _run_alembic(database, "upgrade", "automations_0001")
    with sqlite3.connect(database) as connection:
        connection.execute("""INSERT INTO capability_automations
            (id, vault_scope, vault_path, workspace_id, user_id, role, name, agent_id,
             skill_id, instruction, interval_minutes, enabled, max_runs_per_day,
             max_ai_calls_per_run, max_runtime_seconds, next_run_at, created_at, updated_at, revision, last_status)
            VALUES ('existing', 'vault', '/vault', 'workspace', 'user', 'owner',
                    'Existing', 'agent', 'skill', 'Do work', 60, 1, 4, 4, 180, 12345, 1, 1, 'revision', 'never')""")
        connection.execute("""INSERT INTO capability_automation_runs
            (id, automation_id, status, ai_calls, confirmation_count, started_at)
            VALUES ('run', 'existing', 'completed', 1, 0, 10)""")
    _run_alembic(database, "upgrade", "automations_0002")
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT interval_minutes, next_run_at, schedule FROM capability_automations").fetchone() == (60, 12345, '{"kind":"interval"}')
        assert connection.execute("SELECT status, result_text FROM capability_automation_runs").fetchone() == ("completed", "")


def test_run_persists_actual_final_response(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from langchain_core.messages import AIMessage

    item = capability_automations.save_automation(_scope(), vault_path=tmp_path / "vault", payload=_payload(max_ai_calls_per_run=1))
    class Workflow:
        def compile(self):
            return self

        async def astream(self, *_args, **_kwargs):
            yield {"agent": {"messages": [AIMessage(content="Completed briefing with sources.")]}}
    async def workflow(*_args, **_kwargs):
        return Workflow(), None
    monkeypatch.setattr(capability_automations, "prepare_agent_runtime", lambda *_args, **_kwargs: ({}, {"id": "brain"}, SimpleNamespace(active_skill_ids=[item["skill_id"]])))
    monkeypatch.setattr(capability_automations, "create_agent_workflow", workflow)
    from backend.services.agent_execution_models import AgentExecutionSnapshot, ExecutionScope
    from backend.services.agent_execution_scope import current_scope
    monkeypatch.setattr("backend.services.agent_execution_scope.revalidate_scope", lambda scope: None)
    monkeypatch.setattr("backend.services.agent_execution.revalidate_scope", lambda scope: None)
    monkeypatch.setattr("backend.services.agent_execution.prepare_snapshot", lambda *args, **kwargs: AgentExecutionSnapshot(scope=current_scope(), agent_id="brain",profile={"id":"brain"},skill_ids=[item["skill_id"]],instructions=[],catalog_revision="test",revision="test"))
    outcome = asyncio.run(capability_automations.run_automation(item["id"], manual=True))
    assert outcome["status"] == "completed"
    assert capability_automations.list_runs(item["id"], _scope())[0]["result_text"] == "Completed briefing with sources."
