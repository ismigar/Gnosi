"""Small SQLite-backed queue for restart-safe background capabilities.

The queue deliberately keeps payloads opaque and bounded.  It is not a general
purpose broker; it provides durable claiming, leases, idempotency and recovery
for local Gnosi workers and remains usable when the API is run with multiple
processes.
"""
from __future__ import annotations

import json
import os
import socket
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from backend.config.app_config import load_params

MAX_PAYLOAD_CHARS = 64_000
MAX_ERROR_CHARS = 2_000
DEFAULT_LEASE_SECONDS = 300
_LOCK = threading.RLock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Optional[datetime] = None) -> str:
    return (value or _now()).isoformat()


def _parse(value: Any) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return _now()
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def queue_path() -> Path:
    root = Path(load_params(strict_env=False).paths["LOCAL_DATA"])
    root.mkdir(parents=True, exist_ok=True)
    return root / "agent_jobs.sqlite3"


def _connect() -> sqlite3.Connection:
    path = queue_path()
    from backend.migrations.runner import (
        data_dir_for_database,
        ensure_database_schema_once,
    )

    ensure_database_schema_once(path, "durable_jobs", data_dir_for_database(path))
    connection = sqlite3.connect(path, timeout=30, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=30000")
    return connection


def _decode(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    for key in ("payload", "result"):
        raw = item.get(key)
        if raw:
            try:
                item[key] = json.loads(raw)
            except (TypeError, ValueError):
                item[key] = None
    return item


def enqueue(
    job_type: str,
    payload: dict[str, Any],
    *,
    idempotency_key: str,
    job_id: Optional[str] = None,
    max_attempts: int = 3,
    available_at: Optional[datetime] = None,
) -> dict[str, Any]:
    """Insert one job or return the existing row for the same idempotency key."""
    payload_text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(payload_text) > MAX_PAYLOAD_CHARS:
        raise ValueError("Durable job payload exceeds the bounded queue limit.")
    normalized_key = str(idempotency_key or "").strip()[:256]
    if not normalized_key:
        raise ValueError("Durable jobs require an idempotency key.")
    created = _iso()
    values = (
        str(job_id or uuid.uuid4().hex), str(job_type or "generic")[:96],
        normalized_key, payload_text, "queued", 0,
        max(1, min(int(max_attempts), 20)), _iso(available_at), created, created,
    )
    with _LOCK, _connect() as connection:
        connection.execute(
            """INSERT OR IGNORE INTO agent_jobs
            (job_id, job_type, idempotency_key, payload, state, attempts,
             max_attempts, available_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", values
        )
        row = connection.execute(
            "SELECT * FROM agent_jobs WHERE idempotency_key = ?", (normalized_key,)
        ).fetchone()
    return _decode(row)


def get(job_id: str) -> Optional[dict[str, Any]]:
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM agent_jobs WHERE job_id = ?", (str(job_id),)
        ).fetchone()
    return _decode(row) if row else None


def claim(job_id: str, worker_id: Optional[str] = None, lease_seconds: int = DEFAULT_LEASE_SECONDS) -> bool:
    """Atomically claim a queued job, or reclaim an expired lease."""
    worker = str(worker_id or f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}")[:160]
    now = _now()
    lease_until = _iso(now + timedelta(seconds=max(10, min(int(lease_seconds), 3_600))))
    with _LOCK, _connect() as connection:
        cursor = connection.execute(
            """UPDATE agent_jobs
            SET state='running', attempts=attempts+1, lease_until=?, worker_id=?, updated_at=?
            WHERE job_id=? AND (state='queued' OR
              (state='running' AND lease_until IS NOT NULL AND lease_until <= ?))
              AND available_at <= ? AND attempts < max_attempts""",
            (lease_until, worker, _iso(now), str(job_id), _iso(now), _iso(now)),
        )
        return cursor.rowcount == 1


def heartbeat(job_id: str, worker_id: str, lease_seconds: int = DEFAULT_LEASE_SECONDS) -> bool:
    lease_until = _iso(_now() + timedelta(seconds=max(10, min(int(lease_seconds), 3_600))))
    with _connect() as connection:
        cursor = connection.execute(
            "UPDATE agent_jobs SET lease_until=?, updated_at=? WHERE job_id=? AND state='running' AND worker_id=?",
            (lease_until, _iso(), str(job_id), str(worker_id)),
        )
    return cursor.rowcount == 1


def complete(job_id: str, worker_id: str, result: Optional[dict[str, Any]] = None) -> bool:
    result_text = json.dumps(result or {}, ensure_ascii=False, separators=(",", ":"))
    result_text = result_text[:MAX_PAYLOAD_CHARS]
    with _connect() as connection:
        cursor = connection.execute(
            """UPDATE agent_jobs SET state='completed', lease_until=NULL, result=?, error=NULL,
            updated_at=? WHERE job_id=? AND state='running' AND worker_id=?""",
            (result_text, _iso(), str(job_id), str(worker_id)),
        )
    return cursor.rowcount == 1


def fail(job_id: str, worker_id: str, error: Any, retry_at: Optional[datetime] = None) -> bool:
    message = str(error or "job failed")[:MAX_ERROR_CHARS]
    state = "queued" if retry_at else "failed"
    with _connect() as connection:
        cursor = connection.execute(
            """UPDATE agent_jobs SET state=?, lease_until=NULL, worker_id=NULL, error=?,
            available_at=?, updated_at=? WHERE job_id=? AND state='running' AND worker_id=?""",
            (state, message, _iso(retry_at), _iso(), str(job_id), str(worker_id)),
        )
    return cursor.rowcount == 1


def cancel(job_id: str, *, reason: Any = "Job cancelled by user.") -> bool:
    """Cancel a queued job or request cooperative cancellation of a running job."""
    message = str(reason or "Job cancelled by user.")[:MAX_ERROR_CHARS]
    with _LOCK, _connect() as connection:
        cursor = connection.execute(
            """UPDATE agent_jobs SET state='cancelled', lease_until=NULL, error=?,
            updated_at=? WHERE job_id=? AND state IN ('queued','running')""",
            (message, _iso(), str(job_id)),
        )
    return cursor.rowcount == 1


def is_cancelled(job_id: str) -> bool:
    """Return whether a job has been cooperatively cancelled."""
    item = get(job_id)
    return bool(item and item.get("state") == "cancelled")


def requeue(job_id: str, *, available_at: Optional[datetime] = None) -> bool:
    """Put a failed/interrupted job back into the durable queue."""
    with _connect() as connection:
        cursor = connection.execute(
            """UPDATE agent_jobs SET state='queued', worker_id=NULL, lease_until=NULL,
            error=NULL, available_at=?, updated_at=? WHERE job_id=? AND state IN ('failed','interrupted','queued')""",
            (_iso(available_at), _iso(), str(job_id)),
        )
    return cursor.rowcount == 1


def reject(job_id: str, error: Any) -> bool:
    """Mark a queued payload permanently failed when no dispatcher owns it."""
    with _connect() as connection:
        cursor = connection.execute(
            "UPDATE agent_jobs SET state='failed', error=?, updated_at=? "
            "WHERE job_id=? AND state='queued'",
            (str(error or "job rejected")[:MAX_ERROR_CHARS], _iso(), str(job_id)),
        )
    return cursor.rowcount == 1


def reconcile_expired() -> int:
    """Return expired running leases to the queue without duplicating claims."""
    with _connect() as connection:
        cursor = connection.execute(
            "UPDATE agent_jobs SET state='queued', worker_id=NULL, lease_until=NULL, updated_at=? "
            "WHERE state='running' AND lease_until IS NOT NULL AND lease_until <= ? AND attempts < max_attempts",
            (_iso(), _iso()),
        )
    return cursor.rowcount


def list_jobs(limit: int = 50) -> list[dict[str, Any]]:
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM agent_jobs ORDER BY created_at DESC LIMIT ?", (max(1, min(int(limit), 200)),)
        ).fetchall()
    return [_decode(row) for row in rows]


def ready_jobs(*, job_type: Optional[str] = None, limit: int = 20) -> list[dict[str, Any]]:
    """Return queued jobs whose persisted availability time has arrived."""
    now = _iso()
    params: list[Any] = [now, max(1, min(int(limit), 100))]
    query = (
        "SELECT * FROM agent_jobs WHERE state='queued' AND available_at <= ? "
        "ORDER BY available_at ASC, created_at ASC LIMIT ?"
    )
    if job_type:
        query = (
            "SELECT * FROM agent_jobs WHERE state='queued' AND available_at <= ? "
            "AND job_type=? ORDER BY available_at ASC, created_at ASC LIMIT ?"
        )
        params = [now, str(job_type)[:96], max(1, min(int(limit), 100))]
    with _connect() as connection:
        rows = connection.execute(query, params).fetchall()
    return [_decode(row) for row in rows]
