"""Persistent, bounded health checks for governed runtime capabilities."""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from backend.config.data_dir import resolve_data_dir


_LOCK = threading.RLock()
_FAILURE_THRESHOLD = 2
_FAILURE_WINDOW_SECONDS = 300.0
_QUARANTINE_SECONDS = 60.0
_RETENTION_SECONDS = 30 * 24 * 60 * 60
_CACHE_TTL_SECONDS = 10.0
_cache_loaded_at = 0.0
_cache_rows: dict[str, dict[str, Any]] = {}


def _database_path() -> Path:
    root = resolve_data_dir(create=True)
    return root / "agent_capability_health.sqlite"


def _connect() -> sqlite3.Connection:
    path = _database_path()
    from backend.migrations.runner import (
        data_dir_for_database,
        ensure_database_schema_once,
    )

    ensure_database_schema_once(path, "capability_health", data_dir_for_database(path))
    connection = sqlite3.connect(str(path), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=10000")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    connection.execute(
        "DELETE FROM capability_health WHERE updated_at <= ?",
        (time.time() - _RETENTION_SECONDS,),
    )
    connection.commit()
    return connection


def _key(descriptor: Any, handler: Any = None) -> str:
    raw = descriptor if isinstance(descriptor, dict) else {}
    return str(
        getattr(descriptor, "id", "")
        or raw.get("id", "")
        or getattr(handler, "name", "")
        or getattr(handler, "__name__", "")
    ).strip().lower()[:256]


def _bounded_duration(value: Any) -> int:
    try:
        return max(0, min(int(value or 0), 86_400_000))
    except (TypeError, ValueError):
        return 0


def _invalidate_cache() -> None:
    global _cache_loaded_at
    _cache_loaded_at = 0.0
    _cache_rows.clear()


def _cached_rows() -> dict[str, dict[str, Any]]:
    """Read all small health rows once per TTL instead of once per tool."""
    global _cache_loaded_at
    now = time.monotonic()
    if _cache_loaded_at and now - _cache_loaded_at < _CACHE_TTL_SECONDS:
        return _cache_rows
    with _connect() as connection:
        rows = connection.execute("SELECT * FROM capability_health").fetchall()
    _cache_rows.clear()
    _cache_rows.update({str(row["capability_key"]): dict(row) for row in rows})
    _cache_loaded_at = now
    return _cache_rows


def record_capability_success(
    descriptor: Any,
    handler: Any = None,
    *,
    duration_ms: int = 0,
) -> None:
    """Persist a successful invocation and clear the failure streak."""
    key = _key(descriptor, handler)
    if not key:
        return
    now = time.time()
    duration = _bounded_duration(duration_ms)
    with _LOCK, _connect() as connection:
        connection.execute(
            """
            INSERT INTO capability_health (
                capability_key, successes, failures, consecutive_failures,
                last_success_at, quarantined_until, latency_total_ms,
                latency_samples, updated_at
            ) VALUES (?, 1, 0, 0, ?, NULL, ?, ?, ?)
            ON CONFLICT(capability_key) DO UPDATE SET
                successes = capability_health.successes + 1,
                consecutive_failures = 0,
                last_success_at = excluded.last_success_at,
                quarantined_until = NULL,
                latency_total_ms = capability_health.latency_total_ms + excluded.latency_total_ms,
                latency_samples = capability_health.latency_samples + excluded.latency_samples,
                updated_at = excluded.updated_at
            """,
            (key, now, duration, 1 if duration else 0, now),
        )
    with _LOCK:
        _invalidate_cache()


def record_capability_failure(
    descriptor: Any,
    handler: Any = None,
    *,
    error_code: str = "tool_error",
    duration_ms: int = 0,
) -> dict[str, Any]:
    """Persist a bounded failure and quarantine repeatedly failing tools."""
    key = _key(descriptor, handler)
    if not key:
        return {"status": "unavailable", "reason": str(error_code)[:80]}
    now = time.time()
    duration = _bounded_duration(duration_ms)
    with _LOCK, _connect() as connection:
        row = connection.execute(
            "SELECT * FROM capability_health WHERE capability_key = ?",
            (key,),
        ).fetchone()
        _invalidate_cache()
        previous_failure = float(row["last_failure_at"] or 0) if row else 0.0
        streak = int(row["consecutive_failures"] or 0) if row else 0
        if not previous_failure or now - previous_failure > _FAILURE_WINDOW_SECONDS:
            streak = 0
        streak += 1
        quarantined_until = now + _QUARANTINE_SECONDS if streak >= _FAILURE_THRESHOLD else None
        connection.execute(
            """
            INSERT INTO capability_health (
                capability_key, failures, consecutive_failures,
                last_error_code, last_failure_at, quarantined_until,
                latency_total_ms, latency_samples, updated_at
            ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(capability_key) DO UPDATE SET
                failures = capability_health.failures + 1,
                consecutive_failures = excluded.consecutive_failures,
                last_error_code = excluded.last_error_code,
                last_failure_at = excluded.last_failure_at,
                quarantined_until = excluded.quarantined_until,
                latency_total_ms = capability_health.latency_total_ms + excluded.latency_total_ms,
                latency_samples = capability_health.latency_samples + excluded.latency_samples,
                updated_at = excluded.updated_at
            """,
            (
                key, streak, str(error_code or "tool_error")[:80], now,
                quarantined_until, duration, 1 if duration else 0, now,
            ),
        )
        row = connection.execute(
            "SELECT * FROM capability_health WHERE capability_key = ?",
            (key,),
        ).fetchone()
    if row is None:
        raise RuntimeError("Capability health insert did not return a row")
    return _health_from_row(dict(row), now)


def _health_from_row(row: dict[str, Any], now: float) -> dict[str, Any]:
    quarantined_until = float(row["quarantined_until"] or 0.0)
    samples = int(row["latency_samples"] or 0)
    result: dict[str, Any] = {
        "status": "quarantined" if quarantined_until > now else "healthy",
        "reason": "repeated_runtime_failures" if quarantined_until > now else "ready",
        "successes": int(row["successes"] or 0),
        "failures": int(row["failures"] or 0),
        "recent_failures": int(row["consecutive_failures"] or 0),
        "average_latency_ms": (
            int(row["latency_total_ms"] or 0) // samples if samples else 0
        ),
    }
    if quarantined_until > now:
        result["quarantined_until"] = round(quarantined_until, 3)
    return result


def health_snapshot(descriptor: Any, handler: Any = None) -> dict[str, Any]:
    """Return the persisted public health state without invoking the handler."""
    key = _key(descriptor, handler)
    if not key:
        return {"status": "unavailable", "reason": "missing_id"}
    with _LOCK:
        row = _cached_rows().get(key)
        if not row:
            return {"status": "healthy", "reason": "ready"}
        now = time.time()
        health = _health_from_row(row, now)
        if health["status"] == "healthy" and row["quarantined_until"]:
            with _connect() as connection:
                connection.execute(
                    "UPDATE capability_health SET quarantined_until = NULL WHERE capability_key = ?",
                    (key,),
                )
            _invalidate_cache()
        return health


def list_capability_health(limit: int = 200) -> list[dict[str, Any]]:
    """Return bounded metadata-only health rows for the quality dashboard."""
    with _LOCK, _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM capability_health ORDER BY updated_at DESC LIMIT ?",
            (max(1, min(int(limit), 500)),),
        ).fetchall()
    now = time.time()
    return [
        {"capability_id": row["capability_key"], **_health_from_row(row, now)}
        for row in rows
    ]


def reset_health_for_tests() -> None:
    """Clear persistent health state for isolated tests."""
    with _LOCK, _connect() as connection:
        connection.execute("DELETE FROM capability_health")
        _invalidate_cache()


def assess_tool_capability(descriptor: Any, handler: Any) -> dict[str, Any]:
    """Return a public health record without executing third-party code."""
    raw = descriptor if isinstance(descriptor, dict) else {}
    tool_id = str(getattr(descriptor, "id", "") or raw.get("id", ""))
    name = str(
        getattr(descriptor, "name", "")
        or raw.get("name", "")
        or getattr(handler, "name", "")
        or getattr(handler, "__name__", "")
    )
    if not tool_id:
        return {"status": "unavailable", "reason": "missing_id"}
    if not name:
        return {"status": "unavailable", "reason": "missing_name"}
    if not (callable(handler) or callable(getattr(handler, "invoke", None))):
        return {"status": "unavailable", "reason": "missing_handler"}
    return health_snapshot(descriptor, handler)
