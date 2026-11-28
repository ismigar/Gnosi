"""Persistent multi-step asynchronous workflow chains over the canonical agent executor."""
from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.config.data_dir import resolve_data_dir
from backend.services.agent_execution_models import AgentOperation, ExecutionScope
from backend.services.agent_execution_scope import revalidate_scope

MAX_CHAIN_STEPS = 8
MAX_STEP_OUTPUT_CHARS = 32_000
ChainStatus = Literal["pending", "running", "awaiting_confirmation", "completed", "failed", "cancelled"]


class WorkflowChainConflictError(RuntimeError):
    """Raised when a workflow chain is already running concurrently."""


class WorkflowChainStepDef(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    agent_id: str = Field(min_length=1, max_length=128)
    skill_id: str = Field(min_length=1, max_length=256)
    instruction: str = Field(min_length=1, max_length=12_000)
    max_model_calls: int = Field(default=2, ge=1, le=3)
    timeout_seconds: int = Field(default=180, ge=15, le=900)


class WorkflowChainCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=160)
    steps: list[WorkflowChainStepDef] = Field(min_length=1, max_length=MAX_CHAIN_STEPS)

    @field_validator("steps")
    @classmethod
    def _unique_step_ids(cls, value: list[WorkflowChainStepDef]) -> list[WorkflowChainStepDef]:
        ids = [step.id for step in value]
        if len(set(ids)) != len(ids):
            raise ValueError("Workflow chain step IDs must be unique.")
        return value


class WorkflowChainStepState(BaseModel):
    step_id: str
    name: str
    agent_id: str
    skill_id: str
    instruction: str
    max_model_calls: int = 2
    timeout_seconds: int = 180
    status: ChainStatus = "pending"
    run_id: str = ""
    output_text: str = ""
    error: str = ""
    started_at: float | None = None
    completed_at: float | None = None


class WorkflowChainRun(BaseModel):
    chain_id: str
    name: str
    status: ChainStatus
    current_step_index: int
    steps: list[WorkflowChainStepState]
    created_at: float
    updated_at: float


class StepExecutionResult(BaseModel):
    status: Literal["completed", "awaiting_confirmation", "failed"] = "completed"
    run_id: str = ""
    output_text: str = ""
    error: str = ""


StepRunner = Callable[[ExecutionScope, WorkflowChainStepState, str], Awaitable[StepExecutionResult]]


def _db_path() -> Path:
    root = resolve_data_dir(create=True)
    root.mkdir(parents=True, exist_ok=True)
    return root / "agent_workflow_chains.sqlite"


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    path = _db_path()
    conn = sqlite3.connect(str(path), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS workflow_chains (
            chain_id TEXT PRIMARY KEY,
            vault_path TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            status TEXT NOT NULL,
            current_step_index INTEGER NOT NULL,
            steps_json TEXT NOT NULL,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_workflow_chains_scope ON workflow_chains (vault_path, workspace_id, user_id, updated_at DESC)"
    )
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _row_to_run(row: sqlite3.Row) -> WorkflowChainRun:
    steps = [WorkflowChainStepState.model_validate(item) for item in json.loads(row["steps_json"])]
    return WorkflowChainRun(
        chain_id=str(row["chain_id"]),
        name=str(row["name"]),
        status=row["status"],
        current_step_index=int(row["current_step_index"]),
        steps=steps,
        created_at=float(row["created_at"]),
        updated_at=float(row["updated_at"]),
    )


def _persist(conn: sqlite3.Connection, scope: ExecutionScope, run: WorkflowChainRun, *, guard_cancelled: bool = False) -> bool:
    clause = " AND status != 'cancelled'" if guard_cancelled else ""
    cursor = conn.execute(
        f"""
        UPDATE workflow_chains
           SET status = ?, current_step_index = ?, steps_json = ?, updated_at = ?
         WHERE chain_id = ? AND vault_path = ? AND workspace_id = ? AND user_id = ?{clause}
        """,
        (
            run.status,
            run.current_step_index,
            json.dumps([step.model_dump() for step in run.steps], ensure_ascii=False),
            run.updated_at,
            run.chain_id,
            scope.vault_path,
            scope.workspace_id,
            scope.user_id,
        ),
    )
    return cursor.rowcount > 0


def create_chain(scope: ExecutionScope, payload: WorkflowChainCreate) -> WorkflowChainRun:
    now = time.time()
    chain_id = uuid.uuid4().hex
    steps = [
        WorkflowChainStepState(
            step_id=step.id.strip(),
            name=step.name.strip(),
            agent_id=step.agent_id.strip(),
            skill_id=step.skill_id.strip(),
            instruction=step.instruction.strip(),
            max_model_calls=step.max_model_calls,
            timeout_seconds=step.timeout_seconds,
            status="pending",
        )
        for step in payload.steps
    ]
    run = WorkflowChainRun(
        chain_id=chain_id,
        name=payload.name.strip(),
        status="pending",
        current_step_index=0,
        steps=steps,
        created_at=now,
        updated_at=now,
    )
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO workflow_chains
                (chain_id, vault_path, workspace_id, user_id, name, status, current_step_index, steps_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run.chain_id,
                scope.vault_path,
                scope.workspace_id,
                scope.user_id,
                run.name,
                run.status,
                run.current_step_index,
                json.dumps([step.model_dump() for step in run.steps], ensure_ascii=False),
                run.created_at,
                run.updated_at,
            ),
        )
    return run


def list_chains(scope: ExecutionScope, *, limit: int = 50) -> list[WorkflowChainRun]:
    bounded = max(1, min(int(limit), 200))
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM workflow_chains
             WHERE vault_path = ? AND workspace_id = ? AND user_id = ?
             ORDER BY updated_at DESC
             LIMIT ?
            """,
            (scope.vault_path, scope.workspace_id, scope.user_id, bounded),
        ).fetchall()
    return [_row_to_run(row) for row in rows]


def get_chain(scope: ExecutionScope, chain_id: str) -> WorkflowChainRun:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM workflow_chains
             WHERE chain_id = ? AND vault_path = ? AND workspace_id = ? AND user_id = ?
            """,
            (chain_id, scope.vault_path, scope.workspace_id, scope.user_id),
        ).fetchone()
    if row is None:
        raise LookupError("workflow_chain_not_found")
    return _row_to_run(row)


def cancel_chain(scope: ExecutionScope, chain_id: str) -> WorkflowChainRun:
    run = get_chain(scope, chain_id)
    if run.status in {"completed", "cancelled"}:
        return run
    now = time.time()
    for step in run.steps:
        if step.status in {"pending", "running", "awaiting_confirmation"}:
            step.status = "cancelled"
            step.completed_at = now
    run.status = "cancelled"
    run.updated_at = now
    with _connect() as conn:
        _persist(conn, scope, run)
    return run


async def _default_step_runner(
    scope: ExecutionScope,
    step: WorkflowChainStepState,
    previous_output: str,
) -> StepExecutionResult:
    from backend.config.app_config import load_params
    from backend.services.agent_execution import execute_operation, snapshot_from_runtime
    from backend.services.agent_skill_catalog import resolve_agent_runtime

    agents = load_params(strict_env=False).ai.get("agents", [])
    profile = next(
        (dict(item) for item in agents if isinstance(item, dict) and str(item.get("id") or "") == step.agent_id),
        None,
    )
    if profile is None or not profile.get("enabled", True) or profile.get("plugin_suspended"):
        raise PermissionError(f"workflow_chain_agent_unavailable:{step.agent_id}")
    runtime = resolve_agent_runtime(profile, vault_path=Path(scope.vault_path), active_skill_ids=[step.skill_id])
    if step.skill_id not in runtime.active_skill_ids:
        raise PermissionError(f"workflow_chain_skill_unavailable:{step.skill_id}")
    snapshot = snapshot_from_runtime(scope, profile, runtime)
    prompt_input = step.instruction
    if previous_output:
        prompt_input = f"{step.instruction}\n\nPrevious step output:\n{previous_output[:MAX_STEP_OUTPUT_CHARS]}"
    operation = AgentOperation(
        skill_id=step.skill_id,
        operation=f"workflow_chain.{step.step_id}",
        input=prompt_input,
        max_model_calls=step.max_model_calls,
        timeout_seconds=step.timeout_seconds,
        origin="automation",
    )
    result = await execute_operation(operation, snapshot=snapshot)
    return StepExecutionResult(
        status="completed",
        run_id=str(result.run_id),
        output_text=str(result.result or "")[:MAX_STEP_OUTPUT_CHARS],
    )


async def advance_chain(
    scope: ExecutionScope,
    chain_id: str,
    *,
    step_runner: StepRunner | None = None,
) -> WorkflowChainRun:
    """Run or resume a chain from its first non-completed step without re-running finished steps."""
    run = get_chain(scope, chain_id)
    if run.status in {"completed", "cancelled"}:
        return run
    with _connect() as conn:
        claimed = conn.execute(
            """
            UPDATE workflow_chains
               SET status = 'running', updated_at = ?
             WHERE chain_id = ? AND vault_path = ? AND workspace_id = ? AND user_id = ?
               AND status NOT IN ('running', 'completed', 'cancelled')
            """,
            (time.time(), chain_id, scope.vault_path, scope.workspace_id, scope.user_id),
        ).rowcount
    if claimed == 0:
        latest = get_chain(scope, chain_id)
        if latest.status == "running":
            raise WorkflowChainConflictError("workflow_chain_already_running")
        return latest
    run = get_chain(scope, chain_id)
    runner = step_runner or _default_step_runner
    previous_output = ""
    for index, step in enumerate(run.steps):
        if step.status == "completed":
            previous_output = step.output_text
            continue
        revalidate_scope(scope)
        now = time.time()
        run.status = "running"
        run.current_step_index = index
        step.status = "running"
        step.error = ""
        step.started_at = now
        run.updated_at = now
        with _connect() as conn:
            if not _persist(conn, scope, run, guard_cancelled=True):
                return get_chain(scope, chain_id)
        try:
            outcome = await runner(scope, step, previous_output)
        except Exception as exc:  # noqa: BLE001
            outcome = StepExecutionResult(status="failed", error=str(exc)[:1000])
        done_at = time.time()
        step.run_id = outcome.run_id or step.run_id
        step.output_text = outcome.output_text[:MAX_STEP_OUTPUT_CHARS]
        step.error = outcome.error[:1000]
        step.completed_at = done_at
        run.updated_at = done_at
        if outcome.status == "completed":
            step.status = "completed"
            previous_output = step.output_text
            with _connect() as conn:
                if not _persist(conn, scope, run, guard_cancelled=True):
                    return get_chain(scope, chain_id)
            continue
        if outcome.status == "awaiting_confirmation":
            step.status = "awaiting_confirmation"
            run.status = "awaiting_confirmation"
            with _connect() as conn:
                if not _persist(conn, scope, run, guard_cancelled=True):
                    return get_chain(scope, chain_id)
            return run
        step.status = "failed"
        run.status = "failed"
        with _connect() as conn:
            if not _persist(conn, scope, run, guard_cancelled=True):
                return get_chain(scope, chain_id)
        return run
    run.status = "completed"
    run.current_step_index = len(run.steps)
    run.updated_at = time.time()
    with _connect() as conn:
        if not _persist(conn, scope, run, guard_cancelled=True):
            return get_chain(scope, chain_id)
    return run
