"""Bounded metadata-only audit log for governed capability execution."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, Optional

from backend.config.app_config import load_params


RETENTION_SECONDS = 30 * 24 * 60 * 60
MAX_EVENTS_PER_SCOPE = 500
_schema_lock = threading.Lock()
_schema_ready: set[str] = set()


def _database_path() -> Path:
    root = Path(load_params(strict_env=False).paths["LOCAL_DATA"])
    root.mkdir(parents=True, exist_ok=True)
    return root / "capability_audit.sqlite"


def _restrict_permissions(path: Path) -> None:
    for candidate in (path, Path(f"{path}-wal"), Path(f"{path}-shm")):
        if not candidate.exists():
            continue
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
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS capability_audit_events (
                        id TEXT PRIMARY KEY,
                        vault_scope TEXT NOT NULL,
                        workspace_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        role TEXT NOT NULL,
                        agent_id TEXT NOT NULL,
                        session_id TEXT NOT NULL,
                        tool_id TEXT NOT NULL,
                        tool_name TEXT NOT NULL,
                        effects_json TEXT NOT NULL,
                        status TEXT NOT NULL,
                        argument_keys_json TEXT NOT NULL,
                        result_kind TEXT NOT NULL,
                        error_code TEXT,
                        duration_ms INTEGER NOT NULL,
                        created_at REAL NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_capability_audit_scope_time
                    ON capability_audit_events (
                        vault_scope, workspace_id, user_id,
                        agent_id, session_id, created_at DESC
                    )
                    """
                )
                connection.commit()
                _schema_ready.add(key)
    connection.execute(
        "DELETE FROM capability_audit_events WHERE created_at <= ?",
        (time.time() - RETENTION_SECONDS,),
    )
    connection.commit()
    return connection


@contextmanager
def _database_connection() -> Iterator[sqlite3.Connection]:
    connection = _connect()
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def _safe_scope(scope: Dict[str, str]) -> Dict[str, str]:
    keys = (
        "vault_scope",
        "workspace_id",
        "user_id",
        "role",
        "agent_id",
        "session_id",
    )
    normalized = {key: str(scope.get(key) or "")[:256] for key in keys}
    if any(not normalized[key] for key in keys):
        raise ValueError("The capability audit scope is incomplete.")
    return normalized


def record_capability_event(
    scope: Dict[str, str],
    *,
    tool_id: str,
    tool_name: str,
    effects: list[str],
    status: str,
    argument_keys: list[str] | tuple[str, ...] = (),
    result_kind: str = "none",
    error_code: Optional[str] = None,
    duration_ms: int = 0,
) -> str:
    """Append one event without retaining arguments or returned content."""
    safe_scope = _safe_scope(scope)
    event_id = uuid.uuid4().hex
    safe_effects = sorted({str(value)[:64] for value in effects if value})[:32]
    safe_keys = sorted({str(value)[:120] for value in argument_keys if value})[:100]
    with _database_connection() as connection:
        connection.execute(
            """
            INSERT INTO capability_audit_events (
                id, vault_scope, workspace_id, user_id, role, agent_id,
                session_id, tool_id, tool_name, effects_json, status,
                argument_keys_json, result_kind, error_code, duration_ms,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                safe_scope["vault_scope"],
                safe_scope["workspace_id"],
                safe_scope["user_id"],
                safe_scope["role"],
                safe_scope["agent_id"],
                safe_scope["session_id"],
                str(tool_id or tool_name)[:256],
                str(tool_name or tool_id)[:256],
                json.dumps(safe_effects, separators=(",", ":")),
                str(status or "unknown")[:64],
                json.dumps(safe_keys, separators=(",", ":")),
                str(result_kind or "none")[:64],
                str(error_code or "")[:160] or None,
                max(0, min(int(duration_ms), 86_400_000)),
                time.time(),
            ),
        )
        connection.execute(
            """
            DELETE FROM capability_audit_events
            WHERE id IN (
                SELECT id FROM capability_audit_events
                WHERE vault_scope = ? AND workspace_id = ? AND user_id = ?
                  AND agent_id = ? AND session_id = ?
                ORDER BY created_at DESC
                LIMIT -1 OFFSET ?
            )
            """,
            (
                safe_scope["vault_scope"],
                safe_scope["workspace_id"],
                safe_scope["user_id"],
                safe_scope["agent_id"],
                safe_scope["session_id"],
                MAX_EVENTS_PER_SCOPE,
            ),
        )
    return event_id


def list_capability_events(
    scope: Dict[str, str],
    *,
    limit: int = 100,
    tool_id: Optional[str] = None,
    status: Optional[str] = None,
) -> list[Dict[str, Any]]:
    """List recent metadata-only events from the exact authenticated scope."""
    safe_scope = _safe_scope(scope)
    clauses = [
        "vault_scope = ?", "workspace_id = ?", "user_id = ?",
        "role = ?", "agent_id = ?", "session_id = ?",
    ]
    values: list[Any] = [safe_scope[key] for key in (
        "vault_scope", "workspace_id", "user_id", "role", "agent_id", "session_id",
    )]
    if tool_id:
        clauses.append("tool_id = ?")
        values.append(str(tool_id)[:256])
    if status:
        clauses.append("status = ?")
        values.append(str(status)[:64])
    values.append(max(1, min(int(limit), 500)))
    with _database_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT * FROM capability_audit_events
            WHERE {' AND '.join(clauses)}
            ORDER BY created_at DESC LIMIT ?
            """,
            values,
        ).fetchall()
    return [
        {
            "id": row["id"],
            "tool_id": row["tool_id"],
            "tool_name": row["tool_name"],
            "effects": json.loads(row["effects_json"]),
            "status": row["status"],
            "argument_keys": json.loads(row["argument_keys_json"]),
            "result_kind": row["result_kind"],
            "error_code": row["error_code"] or "",
            "duration_ms": row["duration_ms"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def list_workspace_capability_events(
    scope: Dict[str, str], *, limit: int = 200
) -> list[Dict[str, Any]]:
    """List current-user events across agents and sessions in one Vault."""
    safe_scope = _safe_scope({
        **scope,
        "role": scope.get("role") or "viewer",
        "agent_id": scope.get("agent_id") or "workspace-audit",
        "session_id": scope.get("session_id") or "workspace-audit",
    })
    with _database_connection() as connection:
        rows = connection.execute(
            """
            SELECT * FROM capability_audit_events
            WHERE vault_scope = ? AND workspace_id = ? AND user_id = ?
            ORDER BY created_at DESC LIMIT ?
            """,
            (
                safe_scope["vault_scope"],
                safe_scope["workspace_id"],
                safe_scope["user_id"],
                max(1, min(int(limit), 500)),
            ),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "agent_id": row["agent_id"],
            "session_id": row["session_id"],
            "tool_id": row["tool_id"],
            "tool_name": row["tool_name"],
            "effects": json.loads(row["effects_json"]),
            "status": row["status"],
            "argument_keys": json.loads(row["argument_keys_json"]),
            "result_kind": row["result_kind"],
            "error_code": row["error_code"] or "",
            "duration_ms": row["duration_ms"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]
