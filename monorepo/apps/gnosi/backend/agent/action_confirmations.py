"""Persistent, scope-bound confirmations for consequential agent actions."""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, Optional

from backend.config.app_config import load_params


CONFIRMATION_TTL_SECONDS = 10 * 60
EXECUTION_LEASE_SECONDS = 15 * 60
TERMINAL_RETENTION_SECONDS = 7 * 24 * 60 * 60
MAX_ACTION_ARGUMENT_BYTES = 64 * 1024
MAX_CONFIRMATION_EVENT_BYTES = 16 * 1024
# Compatibility alias for callers that used the old preview-only limit.
MAX_PREVIEW_BYTES = MAX_CONFIRMATION_EVENT_BYTES
CONFIRMATION_EVENT_TYPE = "confirmation_required"
SCRUBBED_PREVIEW_JSON = (
    '{"title_key":"chat.confirmations.title",'
    '"summary_key":"chat.confirmations.summary",'
    '"details":{},"destructive":false}'
)
TERMINAL_STATUSES = frozenset({
    "cancelled",
    "completed",
    "expired",
    "failed",
    "outcome_unknown",
    "partial",
})
ALLOWED_CONFIRMATION_ACTIONS = frozenset({
    "archive_mail",
    "bulk_update_rows",
    "change_schema",
    "create_calendar_event",
    "delete_contact",
    "delete_page",
    "delete_table",
    "empty_trash",
    "governed_tool",
    "invite_attendees",
    "move_mail",
    "restore_page_version",
    "save_mail_draft",
    "send_mail",
})
ACTION_ID_RE = re.compile(r"^[a-f0-9]{32}$")
_SENSITIVE_ARGUMENT_KEYS = frozenset({
    "api_key",
    "authorization",
    "credential",
    "credentials",
    "password",
    "private_key",
    "secret",
    "token",
})
_AUDIT_RESULT_KEYS = frozenset({
    "cleanup_status",
    "contact_id",
    "event_id",
    "failed_count",
    "failed_ids",
    "freed_bytes",
    "id",
    "message_id",
    "page_id",
    "purged_count",
    "rollback_failed_ids",
    "row_ids",
    "status",
    "truncated",
    "updated_count",
})
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


def _restrict_database_permissions(path: Path) -> None:
    """Restrict the database and SQLite sidecars to the service account."""
    for candidate in (path, Path(f"{path}-wal"), Path(f"{path}-shm")):
        if not candidate.exists():
            continue
        try:
            os.chmod(candidate, 0o600)
        except OSError:
            # A deployment filesystem may enforce an even stricter mode.
            continue


def _maintain_rows(connection: sqlite3.Connection, now: float) -> None:
    """Scrub expired/stale rows and delete bounded terminal audit history."""
    connection.execute(
        """
        UPDATE pending_agent_actions
        SET status = 'expired', arguments_json = '{}',
            preview_json = ?, completed_at = ?
        WHERE status = 'pending' AND expires_at <= ?
        """,
        (SCRUBBED_PREVIEW_JSON, now, now),
    )
    connection.execute(
        """
        UPDATE pending_agent_actions
        SET status = 'outcome_unknown', arguments_json = '{}',
            preview_json = ?, error = 'execution_outcome_unknown',
            completed_at = ?
        WHERE status = 'executing'
          AND COALESCE(claimed_at, created_at) <= ?
        """,
        (SCRUBBED_PREVIEW_JSON, now, now - EXECUTION_LEASE_SECONDS),
    )
    connection.execute(
        """
        DELETE FROM pending_agent_actions
        WHERE status IN (
            'cancelled', 'completed', 'expired', 'failed',
            'outcome_unknown', 'partial'
        )
          AND completed_at IS NOT NULL
          AND completed_at <= ?
        """,
        (now - TERMINAL_RETENTION_SECONDS,),
    )


def _connect() -> sqlite3.Connection:
    path = _database_path()
    connection = sqlite3.connect(str(path), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=10000")
    _restrict_database_permissions(path)
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
                        completed_at REAL,
                        claimed_at REAL
                    )
                    """
                )
                columns = {
                    str(row["name"])
                    for row in connection.execute(
                        "PRAGMA table_info(pending_agent_actions)"
                    )
                }
                if "claimed_at" not in columns:
                    connection.execute(
                        "ALTER TABLE pending_agent_actions ADD COLUMN claimed_at REAL"
                    )
                connection.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_pending_agent_actions_expiry
                    ON pending_agent_actions(status, expires_at)
                    """
                )
                connection.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_pending_agent_actions_scope
                    ON pending_agent_actions(
                        vault_scope, workspace_id, user_id, agent_id, session_id,
                        status
                    )
                    """
                )
                connection.commit()
                _schema_ready.add(key)
    with connection:
        _maintain_rows(connection, time.time())
    _restrict_database_permissions(path)
    return connection


@contextmanager
def _database_connection() -> Iterator[sqlite3.Connection]:
    """Commit or roll back one operation and always release the handle."""
    connection = _connect()
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def _normalized_scope(scope: Dict[str, Any]) -> Dict[str, str]:
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
    return {key: str(scope[key]) for key in required}


@contextmanager
def confirmation_context(**scope: str) -> Iterator[None]:
    """Make authenticated request scope available to tool execution."""
    token = _context.set(_normalized_scope(scope))
    try:
        yield
    finally:
        _context.reset(token)


def current_confirmation_scope() -> Dict[str, str]:
    """Return the active authenticated confirmation scope or fail closed."""
    scope = _context.get()
    if not scope:
        raise RuntimeError("Consequential actions require an authenticated chat context.")
    return dict(scope)


def bind_confirmation_context(**scope: str):
    """Bind request scope for a streaming turn and return its reset token."""
    return _context.set(_normalized_scope(scope))


def reset_confirmation_context(token) -> None:
    """Reset a token created by :func:`bind_confirmation_context`."""
    _context.reset(token)


def _encoded_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
        default=str,
    )


def _descriptor_digest(descriptor: Any) -> str:
    """Return a stable digest for a governed descriptor or public mapping."""
    value = (
        descriptor.model_dump(mode="json")
        if callable(getattr(descriptor, "model_dump", None))
        else dict(descriptor or {})
    )
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")
    ).hexdigest()


def _redacted_arguments(value: Any, *, key: str = "") -> Any:
    """Build a bounded JSON-safe preview without leaking secret-like values."""
    normalized_key = key.strip().lower()
    if normalized_key in _SENSITIVE_ARGUMENT_KEYS or any(
        marker in normalized_key for marker in ("password", "secret", "token")
    ):
        raw = _encoded_json(value)
        return {
            "redacted": True,
            "sha256": hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        }
    if isinstance(value, dict):
        return {
            str(item_key)[:120]: _redacted_arguments(item_value, key=str(item_key))
            for item_key, item_value in list(value.items())[:100]
        }
    if isinstance(value, (list, tuple)):
        return [_redacted_arguments(item) for item in list(value)[:100]]
    if isinstance(value, str):
        return value[:12_000]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)[:1_000]


def _audit_result(result: Optional[Dict[str, Any]], status: str) -> Dict[str, Any]:
    """Retain only bounded operational metadata in the confirmation audit."""
    if not isinstance(result, dict):
        return {"status": status}
    safe = {
        key: _redacted_arguments(value, key=key)
        for key, value in result.items()
        if key in _AUDIT_RESULT_KEYS
    }
    safe.setdefault("status", str(result.get("status") or status)[:100])
    return safe


def request_confirmation(
    action: str,
    arguments: Dict[str, Any],
    *,
    title_key: str,
    summary_key: str,
    details: Optional[Dict[str, Any]] = None,
    destructive: bool = True,
) -> str:
    """Persist a pending action and return its complete bounded stream marker."""
    scope = current_confirmation_scope()
    if action not in ALLOWED_CONFIRMATION_ACTIONS:
        raise ValueError("The pending action is not allowlisted.")
    encoded_arguments = _encoded_json(arguments)
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
    event = {
        "type": CONFIRMATION_EVENT_TYPE,
        "confirmation_id": action_id,
        "action": action,
        **preview,
        "expires_at": now + CONFIRMATION_TTL_SECONDS,
    }
    encoded_event = _encoded_json(event)
    if len(encoded_event.encode("utf-8")) > MAX_CONFIRMATION_EVENT_BYTES:
        raise ValueError("The pending action preview exceeds the safety limit.")
    encoded_preview = _encoded_json(preview)

    with _database_connection() as connection:
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
    return encoded_event


def request_governed_tool_confirmation(
    *,
    descriptor: Any,
    tool_name: str,
    tool_arguments: Dict[str, Any],
    active_skill_ids: Iterable[str],
) -> str:
    """Prepare an exact confirmation for a non-native governed tool call."""
    effects = [
        str(getattr(effect, "value", effect))
        for effect in (getattr(descriptor, "effects", None) or [])
    ]
    tool_id = str(getattr(descriptor, "id", "") or "")
    if not tool_id or not tool_name:
        raise ValueError("A governed confirmation requires a stable tool identity.")
    stored = {
        "tool_id": tool_id,
        "tool_name": tool_name,
        "tool_arguments": tool_arguments,
        "descriptor_digest": _descriptor_digest(descriptor),
        "active_skill_ids": sorted({
            str(skill_id) for skill_id in active_skill_ids if str(skill_id)
        }),
        "effects": effects,
    }
    return request_confirmation(
        "governed_tool",
        stored,
        title_key="chat.confirmations.actions.governed_tool.title",
        summary_key="chat.confirmations.actions.governed_tool.summary",
        details={
            "tool": str(getattr(descriptor, "name", "") or tool_name),
            "tool_id": tool_id,
            "effects": effects,
            "arguments": _redacted_arguments(tool_arguments),
        },
        destructive=bool(
            {"destructive", "code_execution"}.intersection(effects)
        ),
    )


def confirmation_event(content: Any) -> Optional[Dict[str, Any]]:
    """Extract a safe confirmation marker from a tool result."""
    if (
        not isinstance(content, str)
        or len(content.encode("utf-8")) > MAX_CONFIRMATION_EVENT_BYTES
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
        or not ACTION_ID_RE.fullmatch(str(payload.get("confirmation_id") or ""))
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


def _public_record(row: sqlite3.Row) -> Dict[str, Any]:
    preview = json.loads(row["preview_json"])
    if preview.get("title_key") == "chat.confirmations.title":
        preview["title_key"] = (
            f"chat.confirmations.actions.{row['action']}.title"
        )
    result = json.loads(row["result_json"] or "{}")
    return {
        "type": CONFIRMATION_EVENT_TYPE,
        "confirmation_id": row["id"],
        "action": row["action"],
        **preview,
        "created_at": row["created_at"],
        "expires_at": row["expires_at"],
        "status": row["status"],
        "result": result,
        "error_code": row["error"] or "",
    }


def list_confirmations(
    scope: Dict[str, str],
    *,
    statuses: Iterable[str] = (
        "cancelled",
        "completed",
        "executing",
        "expired",
        "failed",
        "outcome_unknown",
        "partial",
        "pending",
    ),
) -> list[Dict[str, Any]]:
    """List bounded public confirmation records for one exact chat scope."""
    normalized_statuses = tuple(dict.fromkeys(str(value) for value in statuses))
    if not normalized_statuses:
        return []
    placeholders = ",".join("?" for _ in normalized_statuses)
    with _database_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT * FROM pending_agent_actions
            WHERE vault_scope = ? AND workspace_id = ? AND user_id = ?
              AND role = ? AND agent_id = ? AND session_id = ?
              AND status IN ({placeholders})
            ORDER BY created_at ASC
            LIMIT 100
            """,
            (
                scope["vault_scope"],
                scope["workspace_id"],
                scope["user_id"],
                scope["role"],
                scope["agent_id"],
                scope["session_id"],
                *normalized_statuses,
            ),
        ).fetchall()
    return [_public_record(row) for row in rows]


def get_confirmation_status(
    action_id: str,
    scope: Dict[str, str],
) -> Dict[str, Any]:
    """Return one public status without exposing stored action arguments."""
    with _database_connection() as connection:
        row = connection.execute(
            "SELECT * FROM pending_agent_actions WHERE id = ?",
            (action_id,),
        ).fetchone()
    if row is None:
        raise LookupError("Pending action not found.")
    if not _scope_matches(row, scope):
        raise PermissionError("The pending action belongs to another chat scope.")
    return _public_record(row)


def claim_confirmation(
    action_id: str,
    scope: Dict[str, str],
) -> Dict[str, Any]:
    """Atomically consume a pending action after scope and expiry validation."""
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
        if row["status"] == "expired":
            raise TimeoutError("The pending action has expired.")
        if row["status"] != "pending":
            raise RuntimeError("The pending action is no longer available.")
        if float(row["expires_at"]) <= now:
            connection.execute(
                """
                UPDATE pending_agent_actions
                SET status = 'expired', arguments_json = '{}',
                    preview_json = ?, completed_at = ?
                WHERE id = ?
                """,
                (SCRUBBED_PREVIEW_JSON, now, action_id),
            )
            connection.commit()
            raise TimeoutError("The pending action has expired.")
        updated = connection.execute(
            """
            UPDATE pending_agent_actions
            SET status = 'executing', claimed_at = ?
            WHERE id = ? AND status = 'pending'
            """,
            (now, action_id),
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
    status: Optional[str] = None,
) -> None:
    """Record a terminal one-shot result and scrub sensitive arguments."""
    terminal_status = status or (
        "partial"
        if isinstance(result, dict) and str(result.get("status")) == "partial"
        else ("failed" if error else "completed")
    )
    if terminal_status not in TERMINAL_STATUSES:
        raise ValueError(f"Invalid terminal confirmation status: {terminal_status}")
    safe_result = _audit_result(result, terminal_status)
    encoded_result = _encoded_json(safe_result)
    if len(encoded_result.encode("utf-8")) > MAX_ACTION_ARGUMENT_BYTES:
        encoded_result = _encoded_json({
            "status": (
                safe_result.get("status", terminal_status)
                if isinstance(safe_result, dict)
                else terminal_status
            ),
            "truncated": True,
        })
    with _database_connection() as connection:
        updated = connection.execute(
            """
            UPDATE pending_agent_actions
            SET status = ?, arguments_json = '{}', preview_json = ?,
                result_json = ?, error = ?, completed_at = ?
            WHERE id = ? AND status = 'executing'
            """,
            (
                terminal_status,
                SCRUBBED_PREVIEW_JSON,
                encoded_result,
                str(error or "")[:500] or None,
                time.time(),
                action_id,
            ),
        )
        if updated.rowcount != 1:
            raise RuntimeError("The executing action audit record could not be finalized.")


def cancel_confirmation(action_id: str, scope: Dict[str, str]) -> bool:
    """Cancel and scrub a still-pending action in the same chat scope."""
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
        updated = connection.execute(
            """
            UPDATE pending_agent_actions
            SET status = 'cancelled', arguments_json = '{}',
                preview_json = ?, completed_at = ?
            WHERE id = ? AND status = 'pending'
            """,
            (SCRUBBED_PREVIEW_JSON, now, action_id),
        )
        return updated.rowcount == 1


def cancel_scope_confirmations(scope: Dict[str, str]) -> int:
    """Cancel and scrub every pending action for a deleted chat session."""
    with _database_connection() as connection:
        updated = connection.execute(
            """
            UPDATE pending_agent_actions
            SET status = 'cancelled', arguments_json = '{}',
                preview_json = ?, completed_at = ?
            WHERE vault_scope = ? AND workspace_id = ? AND user_id = ?
              AND agent_id = ? AND session_id = ?
              AND status = 'pending'
            """,
            (
                SCRUBBED_PREVIEW_JSON,
                time.time(),
                scope["vault_scope"],
                scope["workspace_id"],
                scope["user_id"],
                scope["agent_id"],
                scope["session_id"],
            ),
        )
    return int(updated.rowcount or 0)
