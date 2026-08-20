"""Cheap, deterministic health checks for governed runtime capabilities."""

from __future__ import annotations

import threading
import time
from typing import Any


_LOCK = threading.RLock()
_FAILURE_THRESHOLD = 2
_FAILURE_WINDOW_SECONDS = 300.0
_QUARANTINE_SECONDS = 60.0
_records: dict[str, dict[str, Any]] = {}


def _key(descriptor: Any, handler: Any = None) -> str:
    raw = descriptor if isinstance(descriptor, dict) else {}
    return str(
        getattr(descriptor, "id", "")
        or raw.get("id", "")
        or getattr(handler, "name", "")
        or getattr(handler, "__name__", "")
    ).strip().lower()


def record_capability_success(descriptor: Any, handler: Any = None) -> None:
    """Clear consecutive runtime failures after a successful invocation."""
    key = _key(descriptor, handler)
    if not key:
        return
    with _LOCK:
        _records.pop(key, None)


def record_capability_failure(
    descriptor: Any,
    handler: Any = None,
    *,
    error_code: str = "tool_error",
) -> dict[str, Any]:
    """Record a bounded failure and quarantine repeatedly failing tools."""
    key = _key(descriptor, handler)
    if not key:
        return {"status": "unavailable", "reason": error_code}
    now = time.monotonic()
    with _LOCK:
        previous = _records.get(key) or {}
        failures = int(previous.get("failures", 0) or 0)
        if now - float(previous.get("last_failure", now)) > _FAILURE_WINDOW_SECONDS:
            failures = 0
        failures += 1
        quarantined_until = (
            now + _QUARANTINE_SECONDS if failures >= _FAILURE_THRESHOLD else 0.0
        )
        _records[key] = {
            "failures": failures,
            "last_failure": now,
            "error_code": str(error_code or "tool_error")[:80],
            "quarantined_until": quarantined_until,
        }
        return _health_from_record(_records[key], now)


def _health_from_record(record: dict[str, Any], now: float) -> dict[str, Any]:
    quarantined_until = float(record.get("quarantined_until", 0.0) or 0.0)
    if quarantined_until > now:
        return {
            "status": "quarantined",
            "reason": "repeated_runtime_failures",
            "failures": int(record.get("failures", 0) or 0),
            "quarantined_until": round(quarantined_until, 3),
        }
    return {
        "status": "healthy",
        "reason": "ready",
        "recent_failures": int(record.get("failures", 0) or 0),
    }


def health_snapshot(descriptor: Any, handler: Any = None) -> dict[str, Any]:
    """Return current public health state without executing the handler."""
    key = _key(descriptor, handler)
    if not key:
        return {"status": "unavailable", "reason": "missing_id"}
    with _LOCK:
        record = _records.get(key)
        if not record:
            return {"status": "healthy", "reason": "ready"}
        health = _health_from_record(record, time.monotonic())
        if health["status"] == "healthy":
            _records.pop(key, None)
        return health


def reset_health_for_tests() -> None:
    """Clear process-local health state for isolated tests."""
    with _LOCK:
        _records.clear()


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
    errors: list[str] = []
    if not tool_id:
        errors.append("missing_id")
    if not name:
        errors.append("missing_name")
    if not (callable(handler) or callable(getattr(handler, "invoke", None))):
        errors.append("missing_handler")
    if errors:
        return {"status": "unavailable", "reason": errors[0]}
    runtime_health = health_snapshot(descriptor, handler)
    return runtime_health
