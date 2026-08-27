"""Durable turn claims preventing duplicate concurrent execution."""
from __future__ import annotations

import hashlib
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from backend.config.app_config import load_params


def _db() -> sqlite3.Connection:
    root = Path(load_params(strict_env=False).paths["LOCAL_DATA"])
    root.mkdir(parents=True, exist_ok=True)
    path = root / "agent_turns.sqlite3"
    from backend.migrations.runner import ensure_database_schema_once

    ensure_database_schema_once(path, "turn_claims", root)
    connection = sqlite3.connect(path, timeout=30, isolation_level=None)
    connection.execute("PRAGMA journal_mode=WAL")
    return connection


def claim(*, vault_scope: str, workspace_id: str, user_id: str, agent_id: str, session_id: str, turn_id: str, trace_id: str) -> bool:
    raw = "|".join((vault_scope, workspace_id, user_id, agent_id, session_id, turn_id))
    key = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    with _db() as connection:
        cursor = connection.execute(
            "INSERT OR IGNORE INTO turn_claims(claim_key,state,trace_id,updated_at) VALUES(?,?,?,?)",
            (key, "running", str(trace_id)[:64], now),
        )
        return cursor.rowcount == 1


def finish(*, vault_scope: str, workspace_id: str, user_id: str, agent_id: str, session_id: str, turn_id: str, state: str = "completed") -> None:
    raw = "|".join((vault_scope, workspace_id, user_id, agent_id, session_id, turn_id))
    key = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    with _db() as connection:
        connection.execute("UPDATE turn_claims SET state=?, updated_at=? WHERE claim_key=?", (str(state)[:32], datetime.now(timezone.utc).isoformat(), key))
