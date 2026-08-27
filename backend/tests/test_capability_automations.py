"""Tests for durable governed capability automations."""
from __future__ import annotations

import asyncio

import pytest

from backend.services import capability_automations


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
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
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
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
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
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
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
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
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
