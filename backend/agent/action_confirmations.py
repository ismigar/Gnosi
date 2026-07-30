"""Persistent, scope-bound confirmations for consequential agent actions."""
from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Any, Dict, Iterator, Optional

from backend.config.app_config import load_params


CONFIRMATION_TTL_SECONDS = 10 * 60
MAX_ACTION_ARGUMENT_BYTES = 64 * 1024
MAX_PREVIEW_BYTES = 16 * 1024
CONFIRMATION_EVENT_TYPE = "confirmation_required"
ALLOWED_CONFIRMATION_ACTIONS = frozenset({
    "archive_mail",
    "bulk_update_rows",
    "change_schema",
    "delete_contact",
    "delete_page",
    "delete_table",
    "empty_trash",
    "invite_attendees",
    "move_mail",
    "restore_page_version",
    "send_mail",
})
ACTION_ID_RE = re.compile(r"^[a-f0-9]{32}$")
_context: ContextVar[Optional[Dict[str, str]]] = ContextVar(
    "agent_action_confirmation_context",
    default=None,
)
_schema_lock = threading.Lock()
_schema_ready: set[str] = set()


def _database_path() -> Path:
    cfg = load_params(strict_env=False)
    root = Path(cfg.paths["LOCAL_DATA"])
    root.mkdir(parents=True, exist_ok=True)
    return root / "agent_action_confirmations.sqlite"


def _connect() -> sqlite3.Connection:
    path = _database_path()
    connection = sqlite3.connect(str(path), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=10000")
    key = str(path)
    if key not in _schema_ready:
        with _schema_lock:
            if key not in _schema_ready:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS pending_agent_actions (
                        id TEXT PRIMARY KEY,
                        action TEXT NOT NULL,
                        arguments_json TEXT NOT NULL,
                        preview_json TEXT NOT NULL,
                        vault_scope TEXT NOT NULL,
                        workspace_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        role TEXT NOT NULL,
                        agent_id TEXT NOT NULL,
                        session_id TEXT NOT NULL,
                        created_at REAL NOT NULL,
                        expires_at REAL NOT NULL,
                        status TEXT NOT NULL,
                        result_json TEXT,
                        error TEXT,
                        completed_at REAL
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_pending_agent_actions_expiry
                    ON pending_agent_actions(status, expires_at)
                    """
                )
                connection.commit()
                _schema_ready.add(key)
    return connection


@contextmanager
def _database_connection() -> Iterator[sqlite3.Connection]:
    """Commits or rolls back one operation and always releases the handle."""
    connection = _connect()
    try:
        with connection:
            yield connection
    finally:
        connection.close()


@contextmanager
def confirmation_context(**scope: str) -> Iterator[None]:
    """Makes the authenticated request scope available to tool execution."""
    required = {
        "vault_scope",
        "workspace_id",
        "user_id",
        "role",
        "agent_id",
        "session_id",
    }
    missing = sorted(key for key in required if not str(scope.get(key) or "").strip())
    if missing:
        raise RuntimeError(f"Missing confirmation scope: {', '.join(missing)}")
    normalized = {key: str(value) for key, value in scope.items()}
    token = _context.set(normalized)
    try:
        yield
    finally:
        _context.reset(token)


def current_confirmation_scope() -> Dict[str, str]:
    """Returns the active authenticated confirmation scope or fails closed."""
    scope = _context.get()
    if not scope:
        raise RuntimeError("Consequential actions require an authenticated chat context.")
    return dict(scope)


def bind_confirmation_context(**scope: str):
    """Binds request scope for a streaming turn and returns its reset token."""
    required = {
        "vault_scope",
        "workspace_id",
        "user_id",
        "role",
        "agent_id",
        "session_id",
    }
    missing = sorted(key for key in required if not str(scope.get(key) or "").strip())
    if missing:
        raise RuntimeError(f"Missing confirmation scope: {', '.join(missing)}")
    return _context.set({key: str(value) for key, value in scope.items()})


def reset_confirmation_context(token) -> None:
    """Resets a token created by :func:`bind_confirmation_context`."""
    _context.reset(token)


def request_confirmation(
    action: str,
    arguments: Dict[str, Any],
    *,
    title_key: str,
    summary_key: str,
    details: Optional[Dict[str, Any]] = None,
    destructive: bool = True,
) -> str:
    """Persists a pending action and returns its bounded stream marker."""
    scope = current_confirmation_scope()
    if action not in ALLOWED_CONFIRMATION_ACTIONS:
        raise ValueError("The pending action is not allowlisted.")
    encoded_arguments = json.dumps(
        arguments,
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )
    if len(encoded_arguments.encode("utf-8")) > MAX_ACTION_ARGUMENT_BYTES:
        raise ValueError("The pending action arguments exceed the safety limit.")

    now = time.time()
    action_id = uuid.uuid4().hex
    preview = {
        "title_key": str(title_key)[:200],
        "summary_key": str(summary_key)[:200],
        "details": details or {},
        "destructive": bool(destructive),
    }
    encoded_preview = json.dumps(
        preview,
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )
    if len(encoded_preview.encode("utf-8")) > MAX_PREVIEW_BYTES:
        raise ValueError("The pending action preview exceeds the safety limit.")

    with _database_connection() as connection:
        connection.execute(
            """
            UPDATE pending_agent_actions
            SET status = 'expired', completed_at = ?
            WHERE status = 'pending' AND expires_at <= ?
            """,
            (now, now),
        )
        connection.execute(
            """
            INSERT INTO pending_agent_actions (
                id, action, arguments_json, preview_json,
                vault_scope, workspace_id, user_id, agent_id, session_id,
                role, created_at, expires_at, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
            """,
            (
                action_id,
                action,
                encoded_arguments,
                encoded_preview,
                scope["vault_scope"],
                scope["workspace_id"],
                scope["user_id"],
                scope["agent_id"],
                scope["session_id"],
                scope["role"],
                now,
                now + CONFIRMATION_TTL_SECONDS,
            ),
        )

    return json.dumps(
        {
            "type": CONFIRMATION_EVENT_TYPE,
            "confirmation_id": action_id,
            "action": action,
            **preview,
            "expires_at": now + CONFIRMATION_TTL_SECONDS,
        },
        ensure_ascii=False,
        default=str,
    )


def confirmation_event(content: Any) -> Optional[Dict[str, Any]]:
    """Extracts a safe confirmation marker from a tool result."""
    if (
        not isinstance(content, str)
        or len(content.encode("utf-8")) > MAX_PREVIEW_BYTES
    ):
        return None
    try:
        payload = json.loads(content)
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict) or payload.get("type") != CONFIRMATION_EVENT_TYPE:
        return None
    if (
        payload.get("action") not in ALLOWED_CONFIRMATION_ACTIONS
        or not ACTION_ID_RE.fullmatch(
            str(payload.get("confirmation_id") or ""),
        )
    ):
        return None
    allowed = {
        "type",
        "confirmation_id",
        "action",
        "title_key",
        "summary_key",
        "details",
        "destructive",
        "expires_at",
    }
    return {key: payload.get(key) for key in allowed if key in payload}


def _scope_matches(row: sqlite3.Row, scope: Dict[str, str]) -> bool:
    return all(
        str(row[key]) == str(scope.get(key) or "")
        for key in (
            "vault_scope",
            "workspace_id",
            "user_id",
            "role",
            "agent_id",
            "session_id",
        )
    )


def claim_confirmation(
    action_id: str,
    scope: Dict[str, str],
) -> Dict[str, Any]:
    """Atomically consumes a pending action after scope and expiry validation."""
    now = time.time()
    connection = _connect()
    try:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT * FROM pending_agent_actions WHERE id = ?",
            (action_id,),
        ).fetchone()
        if row is None:
            raise LookupError("Pending action not found.")
        if not _scope_matches(row, scope):
            raise PermissionError("The pending action belongs to another chat scope.")
        if row["status"] != "pending":
            raise RuntimeError("The pending action is no longer available.")
        if float(row["expires_at"]) <= now:
            connection.execute(
                """
                UPDATE pending_agent_actions
                SET status = 'expired', completed_at = ?
                WHERE id = ?
                """,
                (now, action_id),
            )
            connection.commit()
            raise TimeoutError("The pending action has expired.")
        updated = connection.execute(
            """
            UPDATE pending_agent_actions
            SET status = 'executing'
            WHERE id = ? AND status = 'pending'
            """,
            (action_id,),
        )
        if updated.rowcount != 1:
            raise RuntimeError("The pending action was already claimed.")
        connection.commit()
        return {
            "id": row["id"],
            "action": row["action"],
            "arguments": json.loads(row["arguments_json"]),
            "preview": json.loads(row["preview_json"]),
        }
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise
    finally:
        connection.close()


def finish_confirmation(
    action_id: str,
    *,
    result: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
) -> None:
    """Records the one-shot execution result without making it replayable."""
    status = "failed" if error else "completed"
    encoded_result = json.dumps(
        result or {},
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )
    if len(encoded_result.encode("utf-8")) > MAX_ACTION_ARGUMENT_BYTES:
        encoded_result = json.dumps({
            "status": (
                result.get("status", status)
                if isinstance(result, dict)
                else status
            ),
            "truncated": True,
        })
    with _database_connection() as connection:
        connection.execute(
            """
            UPDATE pending_agent_actions
            SET status = ?, result_json = ?, error = ?, completed_at = ?
            WHERE id = ? AND status = 'executing'
            """,
            (
                status,
                encoded_result,
                str(error or "")[:2000] or None,
                time.time(),
                action_id,
            ),
        )


def cancel_confirmation(action_id: str, scope: Dict[str, str]) -> bool:
    """Cancels a still-pending action in the same authenticated chat scope."""
    now = time.time()
    with _database_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT * FROM pending_agent_actions WHERE id = ?",
            (action_id,),
        ).fetchone()
        if row is None:
            raise LookupError("Pending action not found.")
        if not _scope_matches(row, scope):
            raise PermissionError("The pending action belongs to another chat scope.")
        if row["status"] != "pending":
            return False
        connection.execute(
            """
            UPDATE pending_agent_actions
            SET status = 'cancelled', completed_at = ?
            WHERE id = ? AND status = 'pending'
            """,
            (now, action_id),
        )
        return True
