"""Tests for periodic tool-free skill regression audits."""
from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_skill_audits import (
    SkillAuditCase,
    SkillAuditSuiteCreate,
    _default_case_runner,
    create_audit_suite,
    delete_audit_suite,
    list_audit_runs,
    list_audit_suites,
    run_audit_suite,
    run_due_audits,
)


def _scope(tmp_path: Path, user_id: str = "u1") -> ExecutionScope:
    return ExecutionScope(user_id=user_id, workspace_id="w1", role="owner", vault_path=str(tmp_path))


def _suite_payload(*, enabled: bool = True) -> SkillAuditSuiteCreate:
    return SkillAuditSuiteCreate(
        name="Summary regression audit",
        agent_id="writer",
        skill_id="writing.summary",
        interval_days=7,
        enabled=enabled,
        cases=[
            SkillAuditCase(id="c1", prompt="Summarize note A", expected_substrings=["conclusion"], forbidden_substrings=["TODO"]),
            SkillAuditCase(id="c2", prompt="Summarize note B", expected_substrings=["action"], forbidden_substrings=[]),
        ],
    )


def test_audit_run_detects_regression_against_prior_pass(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr("backend.services.agent_skill_audits.revalidate_scope", lambda _s: None)
    scope = _scope(tmp_path)
    suite = create_audit_suite(scope, _suite_payload())

    async def green_runner(_s: ExecutionScope, _suite: Any, case: SkillAuditCase) -> str:
        return "Final conclusion with clear action items." if case.id == "c1" else "Key action defined."

    first = asyncio.run(run_audit_suite(scope, suite.suite_id, case_runner=green_runner))
    assert first.status == "passed"
    assert first.passed_count == 2
    assert first.regressed_case_ids == []

    async def regressed_runner(_s: ExecutionScope, _suite: Any, case: SkillAuditCase) -> str:
        return "TODO: missing summary" if case.id == "c1" else "Key action defined."

    second = asyncio.run(run_audit_suite(scope, suite.suite_id, case_runner=regressed_runner))
    assert second.status == "regressed"
    assert second.passed_count == 1
    assert second.regressed_case_ids == ["c1"]
    assert second.outcomes[0].forbidden_hits == ["TODO"]
    assert len(list_audit_runs(scope, suite.suite_id)) == 2


def test_run_due_audits_scope_isolation_and_delete(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr("backend.services.agent_skill_audits.revalidate_scope", lambda _s: None)
    scope = _scope(tmp_path, "u1")
    other = _scope(tmp_path, "u2")
    suite = create_audit_suite(scope, _suite_payload(enabled=True))
    assert list_audit_suites(other) == []

    async def ok_runner(_s: ExecutionScope, _suite: Any, _case: SkillAuditCase) -> str:
        return "conclusion and action"

    # Not due yet
    assert asyncio.run(run_due_audits(scope, now=suite.created_at + 10, case_runner=ok_runner)) == []
    # Due after 8 days
    runs = asyncio.run(run_due_audits(scope, now=suite.created_at + 8 * 86_400, case_runner=ok_runner))
    assert len(runs) == 1
    assert runs[0].status == "passed"

    delete_audit_suite(scope, suite.suite_id)
    assert list_audit_suites(scope) == []


def test_default_case_runner_enforces_tool_free_single_call_and_disables_team(tmp_path: Path, monkeypatch: Any) -> None:
    scope = _scope(tmp_path)
    captured: list[tuple[Any, Any]] = []
    monkeypatch.setattr(
        "backend.config.app_config.load_params",
        lambda strict_env=False: SimpleNamespace(
            ai={"agents": [{"id": "writer", "enabled": True, "provider": "openai", "model": "gpt-4o-mini", "team": {"enabled": True}}]},
            paths={},
        ),
    )
    monkeypatch.setattr(
        "backend.services.agent_skill_catalog.resolve_agent_runtime",
        lambda profile, vault_path, active_skill_ids=None: SimpleNamespace(
            active_skill_ids=("writing.summary",), instructions=(), skills=(), catalog_revision="r1"
        ),
    )

    async def fake_execute(operation: Any, *, snapshot: Any) -> Any:
        captured.append((operation, snapshot))
        return SimpleNamespace(run_id="r1", result="conclusion")

    monkeypatch.setattr("backend.services.agent_execution.execute_operation", fake_execute)
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
    suite = create_audit_suite(scope, _suite_payload())
    output = asyncio.run(_default_case_runner(scope, suite, suite.cases[0]))
    assert output == "conclusion"
    assert captured[0][0].tool_mode == "none"
    assert captured[0][0].max_model_calls == 1
    assert captured[0][1].profile["team"] == {"enabled": False}


def test_permission_error_propagates_without_recording_false_regression(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr("backend.services.agent_skill_audits.revalidate_scope", lambda _s: None)
    scope = _scope(tmp_path)
    suite = create_audit_suite(scope, _suite_payload())

    async def denied_runner(_s: ExecutionScope, _suite: Any, _case: SkillAuditCase) -> str:
        raise PermissionError("skill_audit_agent_unavailable:writer")

    with pytest.raises(PermissionError, match="skill_audit_agent_unavailable"):
        asyncio.run(run_audit_suite(scope, suite.suite_id, case_runner=denied_runner))
    assert list_audit_runs(scope, suite.suite_id) == []


def test_audit_suite_validation_rejects_duplicate_ids_and_whitespace() -> None:
    with pytest.raises(ValueError, match="unique"):
        SkillAuditSuiteCreate(
            name="Bad",
            agent_id="a",
            skill_id="s",
            cases=[
                SkillAuditCase(id="dup", prompt="one"),
                SkillAuditCase(id="dup", prompt="two"),
            ],
        )
    with pytest.raises(ValueError):
        SkillAuditSuiteCreate(name="   ", agent_id="a", skill_id="s", cases=[SkillAuditCase(id="c1", prompt="p")])
