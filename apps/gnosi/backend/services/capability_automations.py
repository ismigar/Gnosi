"""Durable, budgeted automation definitions for governed agent skills."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, Optional

from langchain_core.messages import HumanMessage

from backend.agent.action_confirmations import confirmation_context, confirmation_event
from backend.agent.factory import create_agent_workflow, prepare_agent_runtime
from backend.config.app_config import load_params


AUTOMATION_ID_RE = re.compile(r"^[a-f0-9]{32}$")
_schema_lock = threading.Lock()
_schema_ready: set[str] = set()


class AutomationConflictError(RuntimeError):
    """Raised when an automation revision changed before a write."""


def _database_path() -> Path:
    root = Path(load_params(strict_env=False).paths["LOCAL_DATA"])
    root.mkdir(parents=True, exist_ok=True)
    return root / "capability_automations.sqlite"


def _revision(payload: Dict[str, Any]) -> str:
    encoded = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), default=str
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _restrict_permissions(path: Path) -> None:
    for candidate in (path, Path(f"{path}-wal"), Path(f"{path}-shm")):
        if candidate.exists():
            try:
                os.chmod(candidate, 0o600)
            except OSError:
                continue


def _connect() -> sqlite3.Connection:
    path = _database_path()
    connection = sqlite3.connect(str(path), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=10000")
    _restrict_permissions(path)
    key = str(path)
    if key not in _schema_ready:
        with _schema_lock:
            if key not in _schema_ready:
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS capability_automations (
                        id TEXT PRIMARY KEY,
                        vault_scope TEXT NOT NULL,
                        vault_path TEXT NOT NULL,
                        workspace_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        role TEXT NOT NULL,
                        name TEXT NOT NULL,
                        agent_id TEXT NOT NULL,
                        skill_id TEXT NOT NULL,
                        instruction TEXT NOT NULL,
                        interval_minutes INTEGER NOT NULL,
                        enabled INTEGER NOT NULL,
                        max_runs_per_day INTEGER NOT NULL,
                        max_ai_calls_per_run INTEGER NOT NULL,
                        max_runtime_seconds INTEGER NOT NULL,
                        next_run_at REAL,
                        last_run_at REAL,
                        last_status TEXT NOT NULL,
                        created_at REAL NOT NULL,
                        updated_at REAL NOT NULL,
                        revision TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_capability_automations_due
                    ON capability_automations (enabled, next_run_at);
                    CREATE TABLE IF NOT EXISTS capability_automation_runs (
                        id TEXT PRIMARY KEY,
                        automation_id TEXT NOT NULL,
                        status TEXT NOT NULL,
                        ai_calls INTEGER NOT NULL,
                        confirmation_count INTEGER NOT NULL,
                        error_code TEXT,
                        started_at REAL NOT NULL,
                        finished_at REAL,
                        FOREIGN KEY (automation_id)
                            REFERENCES capability_automations(id) ON DELETE CASCADE
                    );
                    CREATE INDEX IF NOT EXISTS idx_capability_automation_runs
                    ON capability_automation_runs (automation_id, started_at DESC);
                    """
                )
                connection.commit()
                _schema_ready.add(key)
    return connection


@contextmanager
def _database_connection() -> Iterator[sqlite3.Connection]:
    connection = _connect()
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def _public(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "agent_id": row["agent_id"],
        "skill_id": row["skill_id"],
        "instruction": row["instruction"],
        "interval_minutes": row["interval_minutes"],
        "enabled": bool(row["enabled"]),
        "budgets": {
            "max_runs_per_day": row["max_runs_per_day"],
            "max_ai_calls_per_run": row["max_ai_calls_per_run"],
            "max_runtime_seconds": row["max_runtime_seconds"],
        },
        "next_run_at": row["next_run_at"],
        "last_run_at": row["last_run_at"],
        "last_status": row["last_status"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "revision": row["revision"],
    }


def _scope_clauses(scope: Dict[str, str]) -> tuple[str, list[str]]:
    clause = "vault_scope = ? AND workspace_id = ? AND user_id = ?"
    return clause, [
        str(scope["vault_scope"]),
        str(scope["workspace_id"]),
        str(scope["user_id"]),
    ]


def list_automations(scope: Dict[str, str]) -> list[Dict[str, Any]]:
    clause, values = _scope_clauses(scope)
    with _database_connection() as connection:
        rows = connection.execute(
            f"SELECT * FROM capability_automations WHERE {clause} ORDER BY name",
            values,
        ).fetchall()
    return [_public(row) for row in rows]


def get_automation(automation_id: str, scope: Dict[str, str]) -> Dict[str, Any]:
    clause, values = _scope_clauses(scope)
    with _database_connection() as connection:
        row = connection.execute(
            f"SELECT * FROM capability_automations WHERE id = ? AND {clause}",
            [automation_id, *values],
        ).fetchone()
    if row is None:
        raise LookupError("Automation not found.")
    return _public(row)


def save_automation(
    scope: Dict[str, str],
    *,
    vault_path: Path,
    payload: Dict[str, Any],
    automation_id: Optional[str] = None,
    expected_revision: Optional[str] = None,
) -> Dict[str, Any]:
    """Create or revision-safely replace one automation definition."""
    now = time.time()
    normalized_id = automation_id or uuid.uuid4().hex
    if not AUTOMATION_ID_RE.fullmatch(normalized_id):
        raise ValueError("Invalid automation ID.")
    definition = {
        "name": str(payload["name"]).strip()[:160],
        "agent_id": str(payload["agent_id"]).strip()[:128],
        "skill_id": str(payload["skill_id"]).strip().lower()[:256],
        "instruction": str(payload["instruction"]).strip()[:12_000],
        "interval_minutes": max(5, min(int(payload["interval_minutes"]), 525_600)),
        "enabled": bool(payload.get("enabled", False)),
        "max_runs_per_day": max(1, min(int(payload.get("max_runs_per_day", 4)), 144)),
        "max_ai_calls_per_run": max(1, min(int(payload.get("max_ai_calls_per_run", 4)), 16)),
        "max_runtime_seconds": max(15, min(int(payload.get("max_runtime_seconds", 180)), 900)),
    }
    if not all((definition["name"], definition["agent_id"], definition["skill_id"], definition["instruction"])):
        raise ValueError("Automation name, agent, skill, and instruction are required.")
    revision = _revision(definition)
    with _database_connection() as connection:
        existing = connection.execute(
            "SELECT * FROM capability_automations WHERE id = ?", (normalized_id,)
        ).fetchone()
        if existing is not None:
            clause, values = _scope_clauses(scope)
            if connection.execute(
                f"SELECT id FROM capability_automations WHERE id = ? AND {clause}",
                [normalized_id, *values],
            ).fetchone() is None:
                raise PermissionError("Automation belongs to another scope.")
            if expected_revision and expected_revision != existing["revision"]:
                raise AutomationConflictError("Automation changed since it was loaded.")
            connection.execute(
                """
                UPDATE capability_automations SET
                    name=?, agent_id=?, skill_id=?, instruction=?,
                    interval_minutes=?, enabled=?, max_runs_per_day=?,
                    max_ai_calls_per_run=?, max_runtime_seconds=?,
                    next_run_at=?, updated_at=?, revision=? WHERE id=?
                """,
                (
                    definition["name"], definition["agent_id"], definition["skill_id"],
                    definition["instruction"], definition["interval_minutes"],
                    int(definition["enabled"]), definition["max_runs_per_day"],
                    definition["max_ai_calls_per_run"], definition["max_runtime_seconds"],
                    now + definition["interval_minutes"] * 60 if definition["enabled"] else None,
                    now, revision, normalized_id,
                ),
            )
        else:
            connection.execute(
                """
                INSERT INTO capability_automations (
                    id, vault_scope, vault_path, workspace_id, user_id, role,
                    name, agent_id, skill_id, instruction, interval_minutes,
                    enabled, max_runs_per_day, max_ai_calls_per_run,
                    max_runtime_seconds, next_run_at, last_run_at, last_status,
                    created_at, updated_at, revision
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'never', ?, ?, ?)
                """,
                (
                    normalized_id, scope["vault_scope"], str(Path(vault_path).resolve()),
                    scope["workspace_id"], scope["user_id"], scope["role"],
                    definition["name"], definition["agent_id"], definition["skill_id"],
                    definition["instruction"], definition["interval_minutes"],
                    int(definition["enabled"]), definition["max_runs_per_day"],
                    definition["max_ai_calls_per_run"], definition["max_runtime_seconds"],
                    now + definition["interval_minutes"] * 60 if definition["enabled"] else None,
                    now, now, revision,
                ),
            )
        row = connection.execute(
            "SELECT * FROM capability_automations WHERE id = ?", (normalized_id,)
        ).fetchone()
    return _public(row)


def delete_automation(automation_id: str, scope: Dict[str, str]) -> None:
    clause, values = _scope_clauses(scope)
    with _database_connection() as connection:
        deleted = connection.execute(
            f"DELETE FROM capability_automations WHERE id = ? AND {clause}",
            [automation_id, *values],
        )
    if deleted.rowcount != 1:
        raise LookupError("Automation not found.")


def list_runs(
    automation_id: str, scope: Dict[str, str], *, limit: int = 50
) -> list[Dict[str, Any]]:
    get_automation(automation_id, scope)
    with _database_connection() as connection:
        rows = connection.execute(
            """
            SELECT * FROM capability_automation_runs
            WHERE automation_id = ? ORDER BY started_at DESC LIMIT ?
            """,
            (automation_id, max(1, min(int(limit), 200))),
        ).fetchall()
    return [dict(row) for row in rows]


def _load_for_run(automation_id: str) -> sqlite3.Row:
    with _database_connection() as connection:
        row = connection.execute(
            "SELECT * FROM capability_automations WHERE id = ?", (automation_id,)
        ).fetchone()
    if row is None:
        raise LookupError("Automation not found.")
    return row


def _reserve_run(row: sqlite3.Row, *, manual: bool) -> str:
    now = time.time()
    day_start = now - 24 * 60 * 60
    run_id = uuid.uuid4().hex
    with _database_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        current = connection.execute(
            "SELECT * FROM capability_automations WHERE id = ?", (row["id"],)
        ).fetchone()
        if current is None or (not manual and not current["enabled"]):
            raise RuntimeError("Automation is disabled or unavailable.")
        if not manual and current["next_run_at"] and current["next_run_at"] > now:
            raise RuntimeError("Automation is not due.")
        running = connection.execute(
            """
            SELECT id, started_at FROM capability_automation_runs
            WHERE automation_id = ? AND status = 'running'
              AND finished_at IS NULL
            ORDER BY started_at DESC LIMIT 1
            """,
            (row["id"],),
        ).fetchone()
        if running is not None:
            stale_before = now - max(int(current["max_runtime_seconds"]) * 2, 900)
            if float(running["started_at"]) > stale_before:
                raise RuntimeError("Automation already has an active run.")
            connection.execute(
                """
                UPDATE capability_automation_runs
                SET status='failed', error_code='stale_run_recovered',
                    finished_at=? WHERE id=?
                """,
                (now, running["id"]),
            )
        count = connection.execute(
            """
            SELECT COUNT(*) FROM capability_automation_runs
            WHERE automation_id = ? AND started_at >= ?
            """,
            (row["id"], day_start),
        ).fetchone()[0]
        if count >= current["max_runs_per_day"]:
            raise RuntimeError("Automation daily run budget exhausted.")
        connection.execute(
            """
            INSERT INTO capability_automation_runs (
                id, automation_id, status, ai_calls, confirmation_count,
                started_at
            ) VALUES (?, ?, 'running', 0, 0, ?)
            """,
            (run_id, row["id"], now),
        )
        connection.execute(
            """
            UPDATE capability_automations
            SET last_run_at=?, last_status='running',
                next_run_at=?, updated_at=? WHERE id=?
            """,
            (now, now + current["interval_minutes"] * 60, now, row["id"]),
        )
    return run_id


async def run_automation(automation_id: str, *, manual: bool = False) -> Dict[str, Any]:
    """Run one automation within hard time and model-call budgets."""
    row = _load_for_run(automation_id)
    run_id = await asyncio.to_thread(_reserve_run, row, manual=manual)
    scope = {
        "vault_scope": row["vault_scope"],
        "workspace_id": row["workspace_id"],
        "user_id": row["user_id"],
        "role": row["role"],
        "agent_id": row["agent_id"],
        "session_id": f"automation-{row['id']}",
    }
    ai_calls = 0
    confirmations = 0
    status = "completed"
    error_code = ""
    try:
        _cfg, agent, runtime = prepare_agent_runtime(
            row["agent_id"],
            vault_path=Path(row["vault_path"]),
            active_skill_ids=[row["skill_id"]],
        )
        active_ids = set(getattr(runtime, "active_skill_ids", ()) or ()) if runtime else set()
        if agent is None or row["skill_id"] not in active_ids:
            raise PermissionError("Automation skill is not assigned and active.")
        workflow, _selection = await create_agent_workflow(
            [], None,
            agent_id=row["agent_id"],
            user_message=row["instruction"],
            active_skill_ids=[row["skill_id"]],
            vault_path=Path(row["vault_path"]),
            prepared_ai_cfg=_cfg,
            prepared_agent_data=agent,
            runtime_capabilities=runtime,
            timeout=row["max_runtime_seconds"],
        )
        if workflow is None:
            raise RuntimeError("Automation agent model is unavailable.")
        application = workflow.compile()
        inputs = {
            "messages": [HumanMessage(content=row["instruction"])],
            "turn_authorized_tool_names": [],
            "active_skill_ids": [row["skill_id"]],
            "current_user_role": row["role"],
        }
        with confirmation_context(**scope):
            async with asyncio.timeout(row["max_runtime_seconds"]):
                async for event in application.astream(
                    inputs,
                    config={"recursion_limit": 32},
                    stream_mode="updates",
                ):
                    for update in event.values():
                        for message in update.get("messages", []):
                            if getattr(message, "type", "") == "ai":
                                ai_calls += 1
                                if ai_calls >= row["max_ai_calls_per_run"]:
                                    status = "budget_exhausted"
                                    break
                            if confirmation_event(getattr(message, "content", None)):
                                confirmations += 1
                        if status == "budget_exhausted":
                            break
                    if status == "budget_exhausted":
                        break
    except Exception as error:
        status = "failed"
        error_code = type(error).__name__
    finally:
        now = time.time()
        with _database_connection() as connection:
            connection.execute(
                """
                UPDATE capability_automation_runs SET status=?, ai_calls=?,
                    confirmation_count=?, error_code=?, finished_at=? WHERE id=?
                """,
                (status, ai_calls, confirmations, error_code or None, now, run_id),
            )
            connection.execute(
                """
                UPDATE capability_automations SET last_status=?, updated_at=?
                WHERE id=?
                """,
                (status, now, automation_id),
            )
    return {
        "run_id": run_id,
        "automation_id": automation_id,
        "status": status,
        "ai_calls": ai_calls,
        "confirmation_count": confirmations,
        "error_code": error_code,
    }


async def run_due_automations() -> Dict[str, Any]:
    """Run a bounded snapshot of due automations sequentially."""
    now = time.time()
    with _database_connection() as connection:
        ids = [
            row["id"] for row in connection.execute(
                """
                SELECT id FROM capability_automations
                WHERE enabled = 1 AND next_run_at <= ?
                ORDER BY next_run_at LIMIT 10
                """,
                (now,),
            ).fetchall()
        ]
    results = []
    for automation_id in ids:
        results.append(await run_automation(automation_id))
    return {"success": True, "due_count": len(ids), "results": results}
