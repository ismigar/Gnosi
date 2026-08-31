"""Privacy-preserving local spans for end-to-end agent diagnostics.

The implementation intentionally has no mandatory telemetry dependency.  It
stores bounded operational metadata only, so an OpenTelemetry exporter can be
added later without changing the agent contract or leaking prompts/sources.
"""
from __future__ import annotations

import contextlib
import contextvars
import json
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Mapping, Optional, TypeAlias

from backend.config.data_dir import resolve_data_dir

MAX_SPANS = 2_000
MAX_ATTRIBUTES = 32
MAX_VALUE_CHARS = 240
SpanValue: TypeAlias = str | int | float | bool
SpanRecord: TypeAlias = dict[str, SpanValue]
_TRACE_ID: contextvars.ContextVar[str] = contextvars.ContextVar("gnosi_trace_id", default="")
_SPANS: deque[SpanRecord] = deque(maxlen=MAX_SPANS)
_LOCK = threading.RLock()

SAFE_KEYS = frozenset({
    "provider", "model", "tool", "status", "route", "mode", "error_code",
    "duration_ms", "model_calls", "tool_calls", "queue_state", "job_type",
    "cache_hit", "result_kind", "retry_attempt", "index_stale",
})


def new_trace_id() -> str:
    return uuid.uuid4().hex


def set_trace_id(trace_id: str) -> contextvars.Token[str]:
    return _TRACE_ID.set(str(trace_id or new_trace_id())[:64])


def current_trace_id() -> str:
    return _TRACE_ID.get() or ""


def _safe_attributes(attributes: Optional[Mapping[object, object]]) -> SpanRecord:
    safe: SpanRecord = {}
    for key, value in list((attributes or {}).items())[:MAX_ATTRIBUTES]:
        normalized_key = str(key or "")[:64]
        if normalized_key not in SAFE_KEYS:
            continue
        if isinstance(value, bool):
            safe[normalized_key] = value
        elif isinstance(value, (int, float)):
            safe[normalized_key] = value
        else:
            safe[normalized_key] = " ".join(str(value or "").split())[:MAX_VALUE_CHARS]
    return safe


def _storage_path() -> Path:
    root = resolve_data_dir(create=True)
    return root / "agent_spans.jsonl"


def record_span(
    name: str,
    *,
    trace_id: str = "",
    started_at: Optional[float] = None,
    status: object = "ok",
    attributes: Optional[Mapping[object, object]] = None,
) -> SpanRecord:
    """Record a bounded span and return the redacted representation."""
    started = started_at or time.monotonic()
    span: SpanRecord = {
        "span_id": uuid.uuid4().hex[:16],
        "trace_id": (trace_id or current_trace_id() or new_trace_id())[:64],
        "name": str(name or "agent.operation")[:96],
        "status": str(status or "ok")[:32],
        "duration_ms": max(0, int((time.monotonic() - started) * 1000)),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **_safe_attributes(attributes),
    }
    with _LOCK:
        _SPANS.append(span)
        try:
            with _storage_path().open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(span, ensure_ascii=True, separators=(",", ":")) + "\n")
        except OSError:
            pass
    return span


@contextlib.contextmanager
def span(
    name: str,
    *,
    trace_id: str = "",
    attributes: Optional[Mapping[object, object]] = None,
) -> Iterator[dict[object, object]]:
    started = time.monotonic()
    holder: dict[object, object] = {"status": "ok"}
    try:
        yield holder
    except Exception as error:
        holder.update({"status": "error", "error_code": type(error).__name__})
        raise
    finally:
        holder["duration_ms"] = int((time.monotonic() - started) * 1000)
        record_span(
            name,
            trace_id=trace_id,
            started_at=started,
            status=holder.get("status", "ok"),
            attributes={**(attributes or {}), **holder},
        )


def recent_spans(trace_id: str = "", limit: int = 100) -> list[SpanRecord]:
    wanted = str(trace_id or "")
    with _LOCK:
        values = list(_SPANS)
    if wanted:
        values = [item for item in values if item.get("trace_id") == wanted]
    return values[-max(1, min(int(limit), 200)):]
