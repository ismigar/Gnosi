"""Tests for persistent multi-step asynchronous agent workflow chains."""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_workflow_chains import (
    StepExecutionResult,
    WorkflowChainCreate,
    WorkflowChainStepDef,
    WorkflowChainStepState,
    advance_chain,
    cancel_chain,
    create_chain,
    get_chain,
    list_chains,
)


def _scope(tmp_path: Path, user_id: str = "u1") -> ExecutionScope:
    return ExecutionScope(user_id=user_id, workspace_id="w1", role="owner", vault_path=str(tmp_path))


def _three_steps() -> WorkflowChainCreate:
    return WorkflowChainCreate(
        name="Research pipeline",
        steps=[
            WorkflowChainStepDef(id="extract", name="Extract", agent_id="doc", skill_id="s.extract", instruction="Extract facts"),
            WorkflowChainStepDef(id="review", name="Review", agent_id="rev", skill_id="s.review", instruction="Review facts"),
            WorkflowChainStepDef(id="publish", name="Publish", agent_id="pub", skill_id="s.publish", instruction="Draft note"),
        ],
    )


def test_chain_runs_three_steps_and_hands_off_outputs(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr("backend.services.agent_workflow_chains.revalidate_scope", lambda _s: None)
    scope = _scope(tmp_path)
    chain = create_chain(scope, _three_steps())
    received_prev: list[str] = []

    async def runner(_s: ExecutionScope, step: WorkflowChainStepState, prev: str) -> StepExecutionResult:
        received_prev.append(prev)
        return StepExecutionResult(status="completed", run_id=f"run-{step.step_id}", output_text=f"out:{step.step_id}")

    finished = asyncio.run(advance_chain(scope, chain.chain_id, step_runner=runner))
    assert finished.status == "completed"
    assert received_prev == ["", "out:extract", "out:review"]
    assert [step.status for step in finished.steps] == ["completed", "completed", "completed"]


def test_chain_failure_and_idempotent_resume_skips_completed_steps(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr("backend.services.agent_workflow_chains.revalidate_scope", lambda _s: None)
    scope = _scope(tmp_path)
    chain = create_chain(scope, _three_steps())
    calls: list[str] = []

    async def flaky(_s: ExecutionScope, step: WorkflowChainStepState, _prev: str) -> StepExecutionResult:
        calls.append(step.step_id)
        if step.step_id == "review" and calls.count("review") == 1:
            return StepExecutionResult(status="failed", error="provider timeout")
        return StepExecutionResult(status="completed", run_id=f"r-{step.step_id}", output_text=f"ok-{step.step_id}")

    failed = asyncio.run(advance_chain(scope, chain.chain_id, step_runner=flaky))
    assert failed.status == "failed"
    assert failed.steps[0].status == "completed"
    assert failed.steps[1].status == "failed"
    assert failed.steps[2].status == "pending"

    resumed = asyncio.run(advance_chain(scope, chain.chain_id, step_runner=flaky))
    assert resumed.status == "completed"
    assert calls == ["extract", "review", "review", "publish"]


def test_chain_pauses_on_confirmation_and_supports_cancel_and_scope_isolation(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr("backend.services.agent_workflow_chains.revalidate_scope", lambda _s: None)
    scope = _scope(tmp_path, "u1")
    other = _scope(tmp_path, "u2")
    chain = create_chain(scope, _three_steps())

    async def confirm_runner(_s: ExecutionScope, step: WorkflowChainStepState, _prev: str) -> StepExecutionResult:
        if step.step_id == "review":
            return StepExecutionResult(status="awaiting_confirmation", run_id="r-confirm")
        return StepExecutionResult(status="completed", output_text="done")

    paused = asyncio.run(advance_chain(scope, chain.chain_id, step_runner=confirm_runner))
    assert paused.status == "awaiting_confirmation"
    assert paused.steps[2].status == "pending"

    assert list_chains(other) == []
    with pytest.raises(LookupError):
        get_chain(other, chain.chain_id)

    cancelled = cancel_chain(scope, chain.chain_id)
    assert cancelled.status == "cancelled"
    assert cancelled.steps[1].status == "cancelled"
    assert cancelled.steps[2].status == "cancelled"


def test_chain_rejects_duplicate_step_ids_and_whitespace() -> None:
    with pytest.raises(ValueError, match="unique"):
        WorkflowChainCreate(
            name="Bad chain",
            steps=[
                WorkflowChainStepDef(id="dup", name="One", agent_id="a", skill_id="s", instruction="x"),
                WorkflowChainStepDef(id="dup", name="Two", agent_id="a", skill_id="s", instruction="y"),
            ],
        )
    with pytest.raises(ValueError):
        WorkflowChainCreate(
            name="   ",
            steps=[WorkflowChainStepDef(id="s1", name="One", agent_id="a", skill_id="s", instruction="x")],
        )
    with pytest.raises(ValueError):
        WorkflowChainStepDef(id="s1", name="One", agent_id="a", skill_id="s", instruction="x", max_model_calls=4)


def test_in_flight_cancellation_is_not_clobbered_by_running_step(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr("backend.services.agent_workflow_chains.revalidate_scope", lambda _s: None)
    scope = _scope(tmp_path)
    chain = create_chain(scope, _three_steps())
    ran: list[str] = []

    async def cancelling_runner(_s: ExecutionScope, step: WorkflowChainStepState, _prev: str) -> StepExecutionResult:
        ran.append(step.step_id)
        cancel_chain(scope, chain.chain_id)
        return StepExecutionResult(status="completed", output_text="late output")

    result = asyncio.run(advance_chain(scope, chain.chain_id, step_runner=cancelling_runner))
    assert result.status == "cancelled"
    assert ran == ["extract"]


def test_default_step_runner_builds_valid_agent_operation(tmp_path: Path, monkeypatch: Any) -> None:
    from types import SimpleNamespace
    from backend.services.agent_workflow_chains import _default_step_runner

    scope = _scope(tmp_path)
    captured: list[Any] = []
    monkeypatch.setattr(
        "backend.config.app_config.load_params",
        lambda strict_env=False: SimpleNamespace(ai={"agents": [{"id": "doc", "enabled": True, "provider": "openai", "model": "gpt-4o-mini"}]}, paths={}),
    )
    monkeypatch.setattr(
        "backend.services.agent_skill_catalog.resolve_agent_runtime",
        lambda profile, vault_path, active_skill_ids=None: SimpleNamespace(
            active_skill_ids=("s.extract",), instructions=(), skills=(), catalog_revision="r1"
        ),
    )

    async def fake_execute(operation: Any, *, snapshot: Any) -> Any:
        captured.append((operation, snapshot))
        return SimpleNamespace(run_id="run-123", result="extracted data")

    monkeypatch.setattr("backend.services.agent_execution.execute_operation", fake_execute)
    step = WorkflowChainStepState(step_id="extract", name="Extract", agent_id="doc", skill_id="s.extract", instruction="Extract facts")
    outcome = asyncio.run(_default_step_runner(scope, step, "prior text"))
    assert outcome.status == "completed"
    assert outcome.run_id == "run-123"
    assert outcome.output_text == "extracted data"
    assert captured[0][0].max_model_calls == 2
    assert "prior text" in captured[0][0].input
