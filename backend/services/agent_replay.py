"""Privacy-safe turn replay metadata for diagnosing agent behavior."""
from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Optional

from backend.config.data_dir import resolve_data_dir

MAX_ATTRIBUTES = 32
MAX_VALUE_CHARS = 240
SAFE_KEYS = frozenset({
    "mode", "route", "execution", "operation", "confidence", "abstain",
    "provider", "model", "status", "error_code", "duration_ms",
    "model_calls", "tool_calls", "evidence_count", "verification_status",
    "privacy_classification", "queue_state", "index_stale", "event_count",
})
_LOCK = threading.RLock()


def _path() -> Path:
    root = resolve_data_dir(create=True)
    return root / "agent_replays.sqlite3"


def _connect() -> sqlite3.Connection:
    path = _path()
    from backend.migrations.runner import (
        data_dir_for_database,
        ensure_database_schema_once,
    )

    ensure_database_schema_once(path, "agent_replay", data_dir_for_database(path))
    connection = sqlite3.connect(path, timeout=30)
    connection.execute("PRAGMA journal_mode=WAL")
    return connection


def _safe_attributes(attributes: Optional[Mapping[str, Any]]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for key, value in list((attributes or {}).items())[:MAX_ATTRIBUTES]:
        key = str(key or "")[:64]
        if key not in SAFE_KEYS:
            continue
        if isinstance(value, (bool, int, float)):
            output[key] = value
        else:
            output[key] = " ".join(str(value or "").split())[:MAX_VALUE_CHARS]
    return output


def record_event(trace_id: str, event_type: str, attributes: Optional[Mapping[str, Any]] = None) -> None:
    """Persist only operational metadata; never pass a prompt or response here."""
    safe_trace = str(trace_id or "")[:64]
    if not safe_trace:
        return
    try:
        with _LOCK, _connect() as connection:
            connection.execute(
                "INSERT INTO replay_events(event_id,trace_id,event_type,attributes,created_at) VALUES(?,?,?,?,?)",
                (
                    uuid.uuid4().hex,
                    safe_trace,
                    str(event_type or "event")[:64],
                    json.dumps(_safe_attributes(attributes), ensure_ascii=True, separators=(",", ":")),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
    except Exception:  # noqa: BLE001
        # Replay is diagnostic metadata and must never break a user turn.
        return


def read_replay(trace_id: str, limit: int = 100) -> list[dict[str, Any]]:
    try:
        with _connect() as connection:
            rows = connection.execute(
                "SELECT event_id,event_type,attributes,created_at FROM replay_events WHERE trace_id=? ORDER BY created_at ASC LIMIT ?",
                (str(trace_id or "")[:64], max(1, min(int(limit), 200))),
            ).fetchall()
    except Exception:  # noqa: BLE001
        return []
    events = []
    for event_id, event_type, raw, created_at in rows:
        try:
            attributes = json.loads(raw)
        except (TypeError, ValueError):
            attributes = {}
        events.append({"event_id": event_id, "event_type": event_type, "attributes": attributes, "created_at": created_at})
    return events
