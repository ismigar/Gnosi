"""Durable Reader job, snapshot and checkpoint storage."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, cast

from backend.config.app_config import load_params
from backend.domains.reader.state import (
    _LOCK,
    DEFAULT_MAX_ATTEMPTS,
    DEFAULT_MODEL_CALL_BUDGET,
    DEFAULT_RETRY_BASE_SECONDS,
    DEFAULT_RETRY_MAX_SECONDS,
    JOB_ID_RE,
    JobRetryBudgetError,
)
from backend.utils.safe_io import safe_write_json


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _vault_key(vault_path: Path) -> str:
    return hashlib.sha256(str(Path(vault_path).resolve()).encode("utf-8")).hexdigest()[:20]


def _root(vault_path: Path) -> Path:
    configured = cast(str | Path, load_params(strict_env=False).paths["LOCAL_DATA"])
    local_data = Path(configured)
    root = local_data / "reader_analysis" / _vault_key(vault_path)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _job_path(vault_path: Path, job_id: str) -> Path:
    return _root(vault_path) / "jobs" / f"{job_id}.json"


def _snapshot_path(vault_path: Path, job_id: str) -> Path:
    return _root(vault_path) / "snapshots" / f"{job_id}.json"


def _checkpoint_path(vault_path: Path, job_id: str, batch_index: int) -> Path:
    return _root(vault_path) / "checkpoints" / job_id / f"batch-{batch_index:06d}.json"


def _result_path(vault_path: Path, job_id: str) -> Path:
    return _root(vault_path) / "results" / f"{job_id}.json"


def _report_path(vault_path: Path, job_id: str) -> Path:
    return _root(vault_path) / "results" / f"{job_id}.md"


def _validate_job_id(job_id: str) -> str:
    normalized = str(job_id or "").strip().lower()
    if not JOB_ID_RE.fullmatch(normalized):
        raise ValueError("Invalid Reader analysis job id.")
    return normalized


def _load_json(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _save_job(vault_path: Path, job: Dict[str, Any]) -> Dict[str, Any]:
    job = dict(job)
    job["updated_at"] = _utc_now()
    safe_write_json(_job_path(vault_path, str(job["job_id"])), job)
    return job


def _update_job(vault_path: Path, job_id: str, **fields: Any) -> Dict[str, Any]:
    with _LOCK:
        job = _load_json(_job_path(vault_path, job_id))
        if not isinstance(job, dict):
            raise KeyError(job_id)
        job.update(fields)
        return _save_job(vault_path, job)


def _public_job(job: Dict[str, Any]) -> Dict[str, Any]:
    allowed = {
        "job_id",
        "state",
        "phase",
        "progress",
        "total_articles",
        "processed_articles",
        "total_batches",
        "completed_batches",
        "language",
        "scope",
        "snapshot_digest",
        "created_at",
        "updated_at",
        "completed_at",
        "error",
        "result_available",
        "retry",
    }
    return {key: job.get(key) for key in allowed if key in job}


def _parse_utc(value: Any) -> Optional[datetime]:
    try:
        parsed = datetime.fromisoformat(str(value or ""))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _default_retry_policy() -> Dict[str, Any]:
    return {
        "automatic_enabled": True,
        "attempt": 0,
        "max_attempts": DEFAULT_MAX_ATTEMPTS,
        "base_delay_seconds": DEFAULT_RETRY_BASE_SECONDS,
        "max_delay_seconds": DEFAULT_RETRY_MAX_SECONDS,
        "next_retry_at": None,
        "model_call_budget": DEFAULT_MODEL_CALL_BUDGET,
        "model_calls_used": 0,
        "last_retry_reason": None,
        "last_resume_kind": "initial",
        "budget_exhausted": False,
    }


def _retry_policy(job: Dict[str, Any]) -> Dict[str, Any]:
    policy = _default_retry_policy()
    stored = job.get("retry")
    if isinstance(stored, dict):
        policy.update(stored)
    policy["attempt"] = max(0, int(policy.get("attempt") or 0))
    policy["max_attempts"] = max(1, min(int(policy.get("max_attempts") or 1), 10))
    policy["base_delay_seconds"] = max(0, min(int(policy.get("base_delay_seconds") or 0), 3_600))
    policy["max_delay_seconds"] = max(
        policy["base_delay_seconds"],
        min(int(policy.get("max_delay_seconds") or 0), 86_400),
    )
    policy["model_call_budget"] = max(1, min(int(policy.get("model_call_budget") or 1), 10_000))
    policy["model_calls_used"] = max(0, int(policy.get("model_calls_used") or 0))
    policy["budget_exhausted"] = bool(
        policy["attempt"] >= policy["max_attempts"]
        or policy["model_calls_used"] >= policy["model_call_budget"]
    )
    return policy


def _is_transient_failure(error: BaseException) -> bool:
    if isinstance(error, (TimeoutError, ConnectionError)):
        return True
    normalized = str(error or "").casefold()
    return any(
        marker in normalized
        for marker in (
            "timed out",
            "timeout",
            "temporarily unavailable",
            "temporary failure",
            "connection reset",
            "connection refused",
            "rate limit",
            "too many requests",
            "http 429",
            "http 502",
            "http 503",
            "http 504",
        )
    )


def _consume_model_call_budget(vault_path: Path, job_id: str) -> None:
    with _LOCK:
        job = _load_json(_job_path(vault_path, job_id))
        if not isinstance(job, dict):
            raise KeyError(job_id)
        policy = _retry_policy(job)
        if policy["model_calls_used"] >= policy["model_call_budget"]:
            policy["budget_exhausted"] = True
            _save_job(vault_path, {**job, "retry": policy})
            raise JobRetryBudgetError("Reader analysis model-call budget exhausted.")
        policy["model_calls_used"] += 1
        policy["budget_exhausted"] = bool(
            policy["model_calls_used"] >= policy["model_call_budget"]
            or policy["attempt"] >= policy["max_attempts"]
        )
        _save_job(vault_path, {**job, "retry": policy})
