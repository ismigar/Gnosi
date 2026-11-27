"""Periodic tool-free skill regression audits with deterministic checks and history."""
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

MAX_AUDIT_CASES = 10
AuditStatus = Literal["passed", "regressed", "failed"]


class SkillAuditCase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    id: str = Field(min_length=1, max_length=64)
    prompt: str = Field(min_length=1, max_length=8_000)
    expected_substrings: list[str] = Field(default_factory=list, max_length=20)
    forbidden_substrings: list[str] = Field(default_factory=list, max_length=20)


class SkillAuditSuiteCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=160)
    agent_id: str = Field(min_length=1, max_length=128)
    skill_id: str = Field(min_length=1, max_length=256)
    interval_days: int = Field(default=7, ge=1, le=90)
    enabled: bool = False
    cases: list[SkillAuditCase] = Field(min_length=1, max_length=MAX_AUDIT_CASES)

    @field_validator("cases")
    @classmethod
    def _unique_case_ids(cls, value: list[SkillAuditCase]) -> list[SkillAuditCase]:
        ids = [case.id for case in value]
        if len(set(ids)) != len(ids):
            raise ValueError("Skill audit case IDs must be unique.")
        return value


class SkillAuditCaseOutcome(BaseModel):
    case_id: str
    passed: bool
    matched: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    forbidden_hits: list[str] = Field(default_factory=list)
    output_preview: str = ""
    error: str = ""


class SkillAuditRun(BaseModel):
    run_id: str
    suite_id: str
    skill_id: str
    status: AuditStatus
    passed_count: int
    total_count: int
    regressed_case_ids: list[str] = Field(default_factory=list)
    outcomes: list[SkillAuditCaseOutcome]
    created_at: float


class SkillAuditSuite(BaseModel):
    suite_id: str
    name: str
    agent_id: str
    skill_id: str
    interval_days: int
    enabled: bool
    cases: list[SkillAuditCase]
    next_run_at: float | None = None
    last_run_at: float | None = None
    last_status: str = ""
    created_at: float
    updated_at: float


CaseRunner = Callable[[ExecutionScope, SkillAuditSuite, SkillAuditCase], Awaitable[str]]


def _db_path() -> Path:
    root = resolve_data_dir(create=True)
    root.mkdir(parents=True, exist_ok=True)
    return root / "agent_skill_audits.sqlite"


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    path = _db_path()
    conn = sqlite3.connect(str(path), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS skill_audit_suites (
            suite_id TEXT PRIMARY KEY,
            vault_path TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            skill_id TEXT NOT NULL,
            interval_days INTEGER NOT NULL,
            enabled INTEGER NOT NULL,
            cases_json TEXT NOT NULL,
            next_run_at REAL,
            last_run_at REAL,
            last_status TEXT NOT NULL DEFAULT '',
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS skill_audit_runs (
            run_id TEXT PRIMARY KEY,
            suite_id TEXT NOT NULL,
            vault_path TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            skill_id TEXT NOT NULL,
            status TEXT NOT NULL,
            passed_count INTEGER NOT NULL,
            total_count INTEGER NOT NULL,
            regressed_json TEXT NOT NULL,
            outcomes_json TEXT NOT NULL,
            created_at REAL NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_skill_audit_suites_scope ON skill_audit_suites (vault_path, workspace_id, user_id, updated_at DESC)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_skill_audit_runs_suite ON skill_audit_runs (suite_id, created_at DESC)"
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


def _row_to_suite(row: sqlite3.Row) -> SkillAuditSuite:
    cases = [SkillAuditCase.model_validate(item) for item in json.loads(row["cases_json"])]
    return SkillAuditSuite(
        suite_id=str(row["suite_id"]),
        name=str(row["name"]),
        agent_id=str(row["agent_id"]),
        skill_id=str(row["skill_id"]),
        interval_days=int(row["interval_days"]),
        enabled=bool(row["enabled"]),
        cases=cases,
        next_run_at=float(row["next_run_at"]) if row["next_run_at"] is not None else None,
        last_run_at=float(row["last_run_at"]) if row["last_run_at"] is not None else None,
        last_status=str(row["last_status"] or ""),
        created_at=float(row["created_at"]),
        updated_at=float(row["updated_at"]),
    )


def _row_to_run(row: sqlite3.Row) -> SkillAuditRun:
    return SkillAuditRun(
        run_id=str(row["run_id"]),
        suite_id=str(row["suite_id"]),
        skill_id=str(row["skill_id"]),
        status=row["status"],
        passed_count=int(row["passed_count"]),
        total_count=int(row["total_count"]),
        regressed_case_ids=[str(item) for item in json.loads(row["regressed_json"])],
        outcomes=[SkillAuditCaseOutcome.model_validate(item) for item in json.loads(row["outcomes_json"])],
        created_at=float(row["created_at"]),
    )


def create_audit_suite(scope: ExecutionScope, payload: SkillAuditSuiteCreate) -> SkillAuditSuite:
    now = time.time()
    suite_id = uuid.uuid4().hex
    next_run = now + payload.interval_days * 86_400 if payload.enabled else None
    suite = SkillAuditSuite(
        suite_id=suite_id,
        name=payload.name,
        agent_id=payload.agent_id,
        skill_id=payload.skill_id,
        interval_days=payload.interval_days,
        enabled=payload.enabled,
        cases=payload.cases,
        next_run_at=next_run,
        last_run_at=None,
        last_status="",
        created_at=now,
        updated_at=now,
    )
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO skill_audit_suites
                (suite_id, vault_path, workspace_id, user_id, name, agent_id, skill_id, interval_days,
                 enabled, cases_json, next_run_at, last_run_at, last_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                suite.suite_id,
                scope.vault_path,
                scope.workspace_id,
                scope.user_id,
                suite.name,
                suite.agent_id,
                suite.skill_id,
                suite.interval_days,
                int(suite.enabled),
                json.dumps([case.model_dump() for case in suite.cases], ensure_ascii=False),
                suite.next_run_at,
                suite.last_run_at,
                suite.last_status,
                suite.created_at,
                suite.updated_at,
            ),
        )
    return suite


def list_audit_suites(scope: ExecutionScope) -> list[SkillAuditSuite]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM skill_audit_suites
             WHERE vault_path = ? AND workspace_id = ? AND user_id = ?
             ORDER BY updated_at DESC
            """,
            (scope.vault_path, scope.workspace_id, scope.user_id),
        ).fetchall()
    return [_row_to_suite(row) for row in rows]


def get_audit_suite(scope: ExecutionScope, suite_id: str) -> SkillAuditSuite:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM skill_audit_suites
             WHERE suite_id = ? AND vault_path = ? AND workspace_id = ? AND user_id = ?
            """,
            (suite_id, scope.vault_path, scope.workspace_id, scope.user_id),
        ).fetchone()
    if row is None:
        raise LookupError("skill_audit_suite_not_found")
    return _row_to_suite(row)


def delete_audit_suite(scope: ExecutionScope, suite_id: str) -> None:
    with _connect() as conn:
        deleted = conn.execute(
            """
            DELETE FROM skill_audit_suites
             WHERE suite_id = ? AND vault_path = ? AND workspace_id = ? AND user_id = ?
            """,
            (suite_id, scope.vault_path, scope.workspace_id, scope.user_id),
        ).rowcount
        if deleted == 0:
            raise LookupError("skill_audit_suite_not_found")
        conn.execute(
            "DELETE FROM skill_audit_runs WHERE suite_id = ? AND vault_path = ? AND workspace_id = ? AND user_id = ?",
            (suite_id, scope.vault_path, scope.workspace_id, scope.user_id),
        )


def list_audit_runs(scope: ExecutionScope, suite_id: str, *, limit: int = 20) -> list[SkillAuditRun]:
    get_audit_suite(scope, suite_id)
    bounded = max(1, min(int(limit), 100))
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM skill_audit_runs
             WHERE suite_id = ? AND vault_path = ? AND workspace_id = ? AND user_id = ?
             ORDER BY created_at DESC
             LIMIT ?
            """,
            (suite_id, scope.vault_path, scope.workspace_id, scope.user_id, bounded),
        ).fetchall()
    return [_row_to_run(row) for row in rows]


def evaluate_case_output(case: SkillAuditCase, output: str) -> SkillAuditCaseOutcome:
    lowered = output.lower()
    matched = [item for item in case.expected_substrings if item and item.lower() in lowered]
    missing = [item for item in case.expected_substrings if item and item.lower() not in lowered]
    forbidden_hits = [item for item in case.forbidden_substrings if item and item.lower() in lowered]
    passed = not missing and not forbidden_hits
    return SkillAuditCaseOutcome(
        case_id=case.id,
        passed=passed,
        matched=matched,
        missing=missing,
        forbidden_hits=forbidden_hits,
        output_preview=output[:500],
    )


async def _default_case_runner(scope: ExecutionScope, suite: SkillAuditSuite, case: SkillAuditCase) -> str:
    from backend.config.app_config import load_params
    from backend.services.agent_execution import execute_operation, snapshot_from_runtime
    from backend.services.agent_skill_catalog import resolve_agent_runtime

    agents = load_params(strict_env=False).ai.get("agents", [])
    profile = next(
        (dict(item) for item in agents if isinstance(item, dict) and str(item.get("id") or "") == suite.agent_id),
        None,
    )
    if profile is None or not profile.get("enabled", True) or profile.get("plugin_suspended"):
        raise PermissionError(f"skill_audit_agent_unavailable:{suite.agent_id}")
    profile["team"] = {"enabled": False}
    runtime = resolve_agent_runtime(profile, vault_path=Path(scope.vault_path), active_skill_ids=[suite.skill_id])
    if suite.skill_id not in runtime.active_skill_ids:
        raise PermissionError(f"skill_audit_skill_unavailable:{suite.skill_id}")
    snapshot = snapshot_from_runtime(scope, profile, runtime)
    operation = AgentOperation(
        skill_id=suite.skill_id,
        operation="skill_audit.case",
        input=case.prompt,
        tool_mode="none",
        max_model_calls=1,
        timeout_seconds=60,
        origin="automation",
    )
    result = await execute_operation(operation, snapshot=snapshot)
    return str(result.result or "")


async def run_audit_suite(
    scope: ExecutionScope,
    suite_id: str,
    *,
    case_runner: CaseRunner | None = None,
) -> SkillAuditRun:
    """Execute all audit cases tool-free, compare with prior run, and persist results."""
    revalidate_scope(scope)
    suite = get_audit_suite(scope, suite_id)
    previous_runs = list_audit_runs(scope, suite_id, limit=1)
    previously_passed = {
        outcome.case_id
        for outcome in (previous_runs[0].outcomes if previous_runs else [])
        if outcome.passed
    }
    runner = case_runner or _default_case_runner
    outcomes: list[SkillAuditCaseOutcome] = []
    for case in suite.cases:
        revalidate_scope(scope)
        try:
            output = await runner(scope, suite, case)
            outcomes.append(evaluate_case_output(case, output))
        except PermissionError:
            raise
        except Exception as exc:  # noqa: BLE001
            outcomes.append(SkillAuditCaseOutcome(case_id=case.id, passed=False, error=str(exc)[:500]))
    passed_count = sum(1 for item in outcomes if item.passed)
    regressed_ids = [item.case_id for item in outcomes if not item.passed and item.case_id in previously_passed]
    status: AuditStatus = "passed" if passed_count == len(outcomes) else ("regressed" if regressed_ids else "failed")
    now = time.time()
    audit_run = SkillAuditRun(
        run_id=uuid.uuid4().hex,
        suite_id=suite.suite_id,
        skill_id=suite.skill_id,
        status=status,
        passed_count=passed_count,
        total_count=len(outcomes),
        regressed_case_ids=regressed_ids,
        outcomes=outcomes,
        created_at=now,
    )
    next_run = now + suite.interval_days * 86_400 if suite.enabled else None
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO skill_audit_runs
                (run_id, suite_id, vault_path, workspace_id, user_id, skill_id, status,
                 passed_count, total_count, regressed_json, outcomes_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                audit_run.run_id,
                audit_run.suite_id,
                scope.vault_path,
                scope.workspace_id,
                scope.user_id,
                audit_run.skill_id,
                audit_run.status,
                audit_run.passed_count,
                audit_run.total_count,
                json.dumps(audit_run.regressed_case_ids),
                json.dumps([item.model_dump() for item in audit_run.outcomes], ensure_ascii=False),
                audit_run.created_at,
            ),
        )
        conn.execute(
            """
            UPDATE skill_audit_suites
               SET last_run_at = ?, next_run_at = ?, last_status = ?, updated_at = ?
             WHERE suite_id = ? AND vault_path = ? AND workspace_id = ? AND user_id = ?
            """,
            (now, next_run, status, now, suite.suite_id, scope.vault_path, scope.workspace_id, scope.user_id),
        )
    return audit_run


async def run_due_audits(
    scope: ExecutionScope,
    *,
    now: float | None = None,
    case_runner: CaseRunner | None = None,
) -> list[SkillAuditRun]:
    """Run all enabled audit suites whose next_run_at is due."""
    cutoff = time.time() if now is None else now
    suites = list_audit_suites(scope)
    runs: list[SkillAuditRun] = []
    for suite in suites:
        if suite.enabled and suite.next_run_at is not None and suite.next_run_at <= cutoff:
            runs.append(await run_audit_suite(scope, suite.suite_id, case_runner=case_runner))
    return runs
