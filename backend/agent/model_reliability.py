"""Why a model call failed, recorded as evidence per provider:model.

A blacklist of "models that are bad at tools" would be wrong twice over: it
ages badly, and it blames the model for failures that are not its fault. What
matters is the REASON, because the reason says whose fault it is:

- `model`   — the model could not do what was asked (malformed tool call,
              context overflow, invalid structured output). Evidence about the
              model itself; worth showing next to the model picker.
- `account` — rate limit, no credit, bad credentials. Says nothing about the
              model. OpenRouter answering 402 must never be read as
              "gpt-4o-mini is bad at tools".
- `provider` — timeouts and 5xx. Transient; the same model on another day is
              fine.

This module only RECORDS and REPORTS. It does not route or disable anything:
the user reads the evidence and decides.

See directive `model_failure_reasons.md`.
"""
from __future__ import annotations

import json
import hashlib
import logging
import os
import tempfile
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)

_lock = threading.RLock()

# Days of history considered "current" when reporting.
WINDOW_DAYS = 30

# reason -> whose fault it is
FAULT: Dict[str, str] = {
    "tool_use_failed": "model",
    "context_length_exceeded": "model",
    "schema_invalid": "model",
    "content_filter": "model",
    "rate_limit": "account",
    "insufficient_credit": "account",
    "auth": "account",
    "not_found": "account",
    "timeout": "provider",
    "server_error": "provider",
    "unknown": "unknown",
}

# Matched in order: the first pattern found in the error text wins, so the
# specific signatures come before the generic ones.
_SIGNATURES = (
    ("tool_use_failed", ("tool_use_failed", "failed to call a function",
                         "not in request.tools", "tool call validation failed")),
    ("context_length_exceeded", ("context_length_exceeded", "maximum context length",
                                 "reduce the length of the messages", "too many tokens")),
    ("schema_invalid", ("json_validate_failed", "response_format", "invalid schema",
                        "failed to generate json")),
    ("content_filter", ("content_filter", "content policy", "was flagged")),
    ("insufficient_credit", ("insufficient_quota", "requires more credits",
                             "billing", "payment required", "402")),
    ("rate_limit", ("rate_limit", "rate limit", "429", "too many requests")),
    ("auth", ("invalid_api_key", "unauthorized", "authentication", "401", "403")),
    ("not_found", ("model_not_found", "does not exist", "404")),
    ("timeout", ("timeout", "timed out", "read operation")),
    ("server_error", ("internal server error", "bad gateway", "service unavailable",
                      "overloaded", "500", "502", "503")),
)


def classify_failure(error: Any) -> str:
    """Maps a provider error to a reason. Pure: `error` may be text or an exception."""
    text = str(error or "").lower()
    if not text:
        return "unknown"
    for reason, needles in _SIGNATURES:
        if any(needle in text for needle in needles):
            return reason
    return "unknown"


def fault_of(reason: str) -> str:
    return FAULT.get(reason, "unknown")


def blames_the_model(reason: str) -> bool:
    """True only for reasons that are evidence ABOUT THE MODEL."""
    return fault_of(reason) == "model"


def _store_path() -> Optional[Path]:
    try:
        from backend.config.app_config import load_params
        # Canonical key is LOCAL_CACHE (same lookup as UsageStore; "GNOSI_LOCAL_DATA"
        # is an env var, not a paths key, and matches nothing here).
        paths = load_params(strict_env=False).paths
        base = paths.get("LOCAL_CACHE") or paths.get("LOCAL_DATA")
        if not base:
            return None
        directory = Path(base)
        if directory.name != "cache":
            directory = directory / "cache"
        directory.mkdir(parents=True, exist_ok=True)
        return directory / "llm_failures.json"
    except Exception:  # noqa: BLE001
        return None


def _load(path: Optional[Path]) -> Dict[str, Any]:
    if not path or not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8")) or {}
    except Exception:  # noqa: BLE001
        return {}


def _save(path: Optional[Path], data: Dict[str, Any]) -> None:
    if not path:
        return
    try:
        # Atomic replace: a crash mid-write must not corrupt the ledger.
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".llm_failures-")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:  # noqa: BLE001
        pass


def record_failure(provider: Optional[str], model_id: Optional[str],
                   error: Any, *, when: Optional[datetime] = None,
                   scope_key: Optional[str] = None) -> Optional[str]:
    """Best-effort record of one failed call. Returns the reason, or None.

    Never raises: bookkeeping must not take down the request that produced it.
    """
    if not provider or not model_id:
        return None
    reason = classify_failure(error)
    stamp = (when or datetime.now()).strftime("%Y-%m-%d")
    scope = hashlib.sha256((scope_key or "legacy").encode("utf-8")).hexdigest()[:20]
    key = f"{scope}|{provider}:{model_id}"
    try:
        with _lock:
            # Whole load→modify→save cycle under the lock: another writer may
            # have recorded since this one read.
            path = _store_path()
            data = _load(path)
            bucket = data.setdefault(key, {})
            by_day = bucket.setdefault(reason, {})
            by_day[stamp] = int(by_day.get(stamp, 0)) + 1
            _save(path, data)
    except Exception:  # noqa: BLE001
        log.debug("Could not record the failure of %s", key, exc_info=True)
    return reason


def _within_window(by_day: Dict[str, int], since: str) -> int:
    return sum(count for day, count in (by_day or {}).items() if day >= since)


def reliability_report(window_days: int = WINDOW_DAYS,
                       *, today: Optional[datetime] = None,
                       scope_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """Per-model evidence within the window, models with model-fault first."""
    since = ((today or datetime.now()) - timedelta(days=window_days)).strftime("%Y-%m-%d")
    with _lock:
        data = _load(_store_path())

    rows: List[Dict[str, Any]] = []
    expected_scope = hashlib.sha256(
        (scope_key or "legacy").encode("utf-8"),
    ).hexdigest()[:20]
    for stored_key, reasons in (data or {}).items():
        if "|" in stored_key:
            stored_scope, key = stored_key.split("|", 1)
        else:
            stored_scope, key = hashlib.sha256(b"legacy").hexdigest()[:20], stored_key
        if stored_scope != expected_scope:
            continue
        provider, _, model_id = key.partition(":")
        counts = {
            reason: _within_window(by_day, since)
            for reason, by_day in (reasons or {}).items()
        }
        counts = {reason: n for reason, n in counts.items() if n > 0}
        if not counts:
            continue
        model_faults = {r: n for r, n in counts.items() if blames_the_model(r)}
        rows.append({
            "provider": provider,
            "model_id": model_id,
            "window_days": window_days,
            "reasons": counts,
            "model_fault_total": sum(model_faults.values()),
            "total": sum(counts.values()),
            # The dominant model-fault reason is what the UI shows; an account
            # problem is not evidence about the model and must not surface there.
            "top_model_reason": (
                max(model_faults, key=lambda reason: model_faults[reason])
                if model_faults
                else None
            ),
        })
    rows.sort(key=lambda r: (-r["model_fault_total"], -r["total"]))
    return rows


def model_evidence(provider: str, model_id: str,
                   window_days: int = WINDOW_DAYS,
                   *, scope_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """The row for one model, or None when it has no recorded failures."""
    key = (provider or "", model_id or "")
    return next(
        (r for r in reliability_report(window_days, scope_key=scope_key)
         if (r["provider"], r["model_id"]) == key),
        None,
    )
