"""Durable Reader analysis lifecycle and retry orchestration."""

from __future__ import annotations

import threading
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from backend.config.logger_config import get_logger
from backend.domains.reader.analysis import (
    _build_batches,
    _default_model_call,
    _digest_snapshot,
    _map_batch,
    _reduce_topic,
    _render_report,
    _snapshot_articles,
)
from backend.domains.reader.internal_sources import normalize_scope
from backend.domains.reader.state import (
    _LOCK,
    _RETRY_TIMERS,
    _THREADS,
    DEFAULT_MAX_ATTEMPTS,
    MAX_GUIDANCE_CHARS,
    RUNNING_STATES,
    TERMINAL_STATES,
    JobRetryBudgetError,
)
from backend.domains.reader.storage import (
    _checkpoint_path,
    _consume_model_call_budget,
    _default_retry_policy,
    _is_transient_failure,
    _job_path,
    _load_json,
    _parse_utc,
    _public_job,
    _report_path,
    _result_path,
    _retry_policy,
    _root,
    _save_job,
    _snapshot_path,
    _update_job,
    _utc_now,
    _validate_job_id,
)
from backend.security.secret_redaction import redact_secrets
from backend.services import durable_job_queue
from backend.utils.safe_io import safe_write_json, safe_write_text

log = get_logger(__name__)


def _cancel_retry_timer(job_id: str) -> None:
    with _LOCK:
        timer = _RETRY_TIMERS.pop(job_id, None)
    if timer:
        timer.cancel()


def _schedule_retry(
    vault_path: Path,
    job_id: str,
    *,
    delay_seconds: int,
    model_call: Callable[[str, str], str],
) -> None:
    """Schedule one in-process retry; persisted status reconciles restarts."""
    _cancel_retry_timer(job_id)

    def launch_due_retry() -> None:
        with _LOCK:
            _RETRY_TIMERS.pop(job_id, None)
        _launch(vault_path, job_id, model_call=model_call)

    timer = threading.Timer(max(0, delay_seconds), launch_due_retry)
    timer.daemon = True
    with _LOCK:
        _RETRY_TIMERS[job_id] = timer
    timer.start()


def _cancel_requested(vault_path: Path, job_id: str) -> bool:
    job = _load_json(_job_path(vault_path, job_id)) or {}
    return bool(job.get("cancel_requested"))


def _begin_attempt(vault_path: Path, job_id: str) -> dict[str, Any]:
    stored_job = _load_json(_job_path(vault_path, job_id))
    if not isinstance(stored_job, dict):
        raise KeyError(job_id)
    retry = _retry_policy(stored_job)
    if retry["attempt"] >= retry["max_attempts"]:
        retry["budget_exhausted"] = True
        _save_job(vault_path, {**stored_job, "retry": retry})
        raise JobRetryBudgetError("Reader analysis retry-attempt budget exhausted.")
    retry["attempt"] += 1
    retry["next_retry_at"] = None
    retry["budget_exhausted"] = False
    return _update_job(
        vault_path,
        job_id,
        state="snapshotting",
        phase="snapshotting",
        progress=1,
        error=None,
        completed_at=None,
        retry=retry,
    )


def _budgeted_model_call(
    vault_path: Path,
    job_id: str,
    worker_id: str,
    model_call: Callable[[str, str], str],
) -> Callable[[str, str], str]:
    def call(prompt: str, user_message: str) -> str:
        if worker_id:
            durable_job_queue.heartbeat(job_id, worker_id)
        _consume_model_call_budget(vault_path, job_id)
        return model_call(prompt, user_message)

    return call


def _load_or_create_snapshot(
    vault_path: Path,
    job_id: str,
    job: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    raw_snapshot = _load_json(_snapshot_path(vault_path, job_id))
    if isinstance(raw_snapshot, list):
        snapshot = [dict(item) for item in raw_snapshot if isinstance(item, dict)]
        snapshot_digest = str(job.get("snapshot_digest") or "")
        if not snapshot_digest:
            snapshot_digest = _digest_snapshot(snapshot)
    else:
        raw_scope = job.get("scope")
        scope = dict(raw_scope) if isinstance(raw_scope, dict) else {}
        snapshot = _snapshot_articles(vault_path, scope)
        snapshot_digest = _digest_snapshot(snapshot)
        safe_write_json(_snapshot_path(vault_path, job_id), snapshot)
    updated = _update_job(
        vault_path,
        job_id,
        state="mapping",
        phase="mapping",
        progress=2,
        total_articles=len(snapshot),
        snapshot_digest=snapshot_digest,
    )
    return snapshot, updated


def _cancel_if_requested(vault_path: Path, job_id: str) -> bool:
    if not _cancel_requested(vault_path, job_id):
        return False
    _update_job(
        vault_path,
        job_id,
        state="cancelled",
        phase="cancelled",
        completed_at=_utc_now(),
    )
    return True


def _map_batches(
    vault_path: Path,
    job_id: str,
    job: dict[str, Any],
    batches: list[dict[str, Any]],
    model_call: Callable[[str, str], str],
    worker_id: str,
) -> list[dict[str, Any]] | None:
    summaries: list[dict[str, Any]] = []
    for index, batch in enumerate(batches):
        if _cancel_if_requested(vault_path, job_id):
            return None
        checkpoint_path = _checkpoint_path(vault_path, job_id, index)
        raw_summary = _load_json(checkpoint_path)
        if isinstance(raw_summary, dict):
            summary = dict(raw_summary)
        else:
            summary = _map_batch(
                batch,
                language=str(job["language"]),
                guidance=str(job.get("guidance") or ""),
                model_call=model_call,
            )
            safe_write_json(checkpoint_path, summary)
        summaries.append(summary)
        processed = len(
            {
                str(identifier)
                for item in summaries
                for identifier in (item.get("_article_ids_all") or item.get("article_ids") or [])
            }
        )
        _update_job(
            vault_path,
            job_id,
            completed_batches=index + 1,
            processed_articles=processed,
            progress=max(3, min(80, int(((index + 1) / max(1, len(batches))) * 80))),
        )
        if worker_id:
            durable_job_queue.heartbeat(job_id, worker_id)
    return summaries


def _complete_analysis(
    vault_path: Path,
    job_id: str,
    job: dict[str, Any],
    snapshot: list[dict[str, Any]],
    summaries: list[dict[str, Any]],
    model_call: Callable[[str, str], str],
) -> None:
    _update_job(vault_path, job_id, state="reducing", phase="reducing", progress=82)
    by_topic: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for summary in summaries:
        by_topic[str(summary.get("topic") or "Uncategorized")].append(summary)
    topics = [
        _reduce_topic(
            topic,
            by_topic[topic],
            language=str(job["language"]),
            guidance=str(job.get("guidance") or ""),
            model_call=model_call,
        )
        for topic in sorted(by_topic, key=str.casefold)
    ]
    result = {
        "job_id": job_id,
        "article_count": len(snapshot),
        "snapshot_digest": job["snapshot_digest"],
        "language": job["language"],
        "scope": job["scope"],
        "request": str(job.get("guidance") or ""),
        "topics": topics,
        "created_at": job["created_at"],
        "completed_at": _utc_now(),
    }
    safe_write_json(_result_path(vault_path, job_id), result)
    safe_write_text(_report_path(vault_path, job_id), _render_report(result))
    current = _load_json(_job_path(vault_path, job_id))
    _update_job(
        vault_path,
        job_id,
        state="completed",
        phase="completed",
        progress=100,
        completed_at=result["completed_at"],
        processed_articles=len(snapshot),
        result_available=True,
        retry={
            **_retry_policy(current if isinstance(current, dict) else {}),
            "next_retry_at": None,
            "last_retry_reason": None,
        },
    )


def _stored_int(value: object) -> int:
    return int(str(value))


def _record_failure(vault_path: Path, job_id: str, error: Exception) -> int | None:
    current_value = _load_json(_job_path(vault_path, job_id))
    current = dict(current_value) if isinstance(current_value, dict) else {}
    retry = _retry_policy(current)
    can_retry = bool(
        _is_transient_failure(error)
        and retry.get("automatic_enabled")
        and retry["attempt"] < retry["max_attempts"]
        and retry["model_calls_used"] < retry["model_call_budget"]
        and not current.get("cancel_requested")
    )
    if can_retry:
        max_delay = _stored_int(retry["max_delay_seconds"])
        base_delay = _stored_int(retry["base_delay_seconds"])
        attempt = _stored_int(retry["attempt"])
        exponential_delay: int = base_delay * (2 ** max(0, attempt - 1))
        delay: int = min(max_delay, exponential_delay)
        retry.update(
            {
                "next_retry_at": (
                    datetime.now(timezone.utc) + timedelta(seconds=delay)
                ).isoformat(),
                "last_retry_reason": type(error).__name__,
                "last_resume_kind": "automatic",
                "budget_exhausted": False,
            }
        )
        _update_job(
            vault_path,
            job_id,
            state="retry_wait",
            phase="retry_wait",
            error=redact_secrets(error, max_chars=2_000),
            completed_at=None,
            retry=retry,
        )
        return delay
    retry.update(
        {
            "next_retry_at": None,
            "last_retry_reason": type(error).__name__,
            "budget_exhausted": bool(
                retry["attempt"] >= retry["max_attempts"]
                or retry["model_calls_used"] >= retry["model_call_budget"]
                or isinstance(error, JobRetryBudgetError)
            ),
        }
    )
    _update_job(
        vault_path,
        job_id,
        state="failed",
        phase="failed",
        error=redact_secrets(error, max_chars=2_000),
        completed_at=_utc_now(),
        retry=retry,
    )
    return None


def _settle_worker(vault_path: Path, job_id: str, worker_id: str, retry_delay: int | None) -> None:
    if not worker_id:
        return
    raw_final_job = _load_json(_job_path(vault_path, job_id))
    final_job = dict(raw_final_job) if isinstance(raw_final_job, dict) else {}
    final_state = str(final_job.get("state") or "")
    if retry_delay is not None:
        durable_job_queue.fail(
            job_id,
            worker_id,
            final_job.get("error") or "retry scheduled",
            _parse_utc(_retry_policy(final_job).get("next_retry_at")),
        )
    elif final_state == "completed":
        durable_job_queue.complete(job_id, worker_id, {"state": final_state})
    elif final_state in TERMINAL_STATES:
        durable_job_queue.fail(job_id, worker_id, final_job.get("error") or final_state)
    else:
        durable_job_queue.fail(job_id, worker_id, final_job.get("error") or "worker stopped")


def _run_job(
    vault_path: Path,
    job_id: str,
    *,
    model_call: Callable[[str, str], str],
    worker_id: str = "",
) -> None:
    from backend.services.context_vars import active_vault_path

    vault_token = active_vault_path.set(Path(vault_path).resolve())
    retry_delay_seconds: Optional[int] = None
    try:
        job = _begin_attempt(vault_path, job_id)
        budgeted_model_call = _budgeted_model_call(vault_path, job_id, worker_id, model_call)
        snapshot, job = _load_or_create_snapshot(vault_path, job_id, job)
        if _cancel_if_requested(vault_path, job_id):
            return
        batches = _build_batches(snapshot)
        _update_job(vault_path, job_id, total_batches=len(batches))
        summaries = _map_batches(
            vault_path,
            job_id,
            job,
            batches,
            budgeted_model_call,
            worker_id,
        )
        if summaries is None:
            return
        _complete_analysis(
            vault_path,
            job_id,
            job,
            snapshot,
            summaries,
            budgeted_model_call,
        )
    except Exception as error:  # noqa: BLE001
        log.exception("Reader analysis job %s failed", job_id)
        retry_delay_seconds = _record_failure(vault_path, job_id, error)
    finally:
        active_vault_path.reset(vault_token)
        with _LOCK:
            _THREADS.pop(job_id, None)
        _settle_worker(vault_path, job_id, worker_id, retry_delay_seconds)
        if retry_delay_seconds is not None:
            _schedule_retry(
                vault_path,
                job_id,
                delay_seconds=retry_delay_seconds,
                model_call=model_call,
            )


def _launch(
    vault_path: Path,
    job_id: str,
    *,
    model_call: Callable[[str, str], str],
) -> None:
    worker_id = f"reader:{uuid.uuid4().hex[:12]}"
    with _LOCK:
        existing = _THREADS.get(job_id)
        if existing and existing.is_alive():
            return
        if not durable_job_queue.claim(job_id, worker_id):
            return
        thread = threading.Thread(
            target=_run_job,
            args=(Path(vault_path).resolve(), job_id),
            kwargs={"model_call": model_call, "worker_id": worker_id},
            name=f"reader-analysis-{job_id[:8]}",
            daemon=True,
        )
        _THREADS[job_id] = thread
        thread.start()


def start_analysis(
    vault_path: Path,
    raw_scope: Any,
    *,
    language: str = "Catalan",
    guidance: str = "",
    model_call: Optional[Callable[[str, str], str]] = None,
    launch: bool = True,
) -> Dict[str, Any]:
    """Queue a durable Reader analysis whose worker creates the snapshot."""
    scope = normalize_scope("reader", raw_scope)
    scope["include_full_content"] = True
    job_id = uuid.uuid4().hex
    job = {
        "job_id": job_id,
        "state": "queued",
        "phase": "queued",
        "progress": 0,
        "scope": scope,
        "language": str(language or "Catalan")[:64],
        "guidance": str(guidance or "")[:MAX_GUIDANCE_CHARS],
        "total_articles": 0,
        "processed_articles": 0,
        "total_batches": 0,
        "completed_batches": 0,
        "snapshot_digest": "",
        "result_available": False,
        "cancel_requested": False,
        "error": None,
        "retry": _default_retry_policy(),
        "created_at": _utc_now(),
        "updated_at": _utc_now(),
    }
    job = _save_job(vault_path, job)
    durable_job_queue.enqueue(
        "reader_analysis",
        {"vault_path": str(Path(vault_path).resolve()), "job_id": job_id},
        idempotency_key=f"reader-analysis:{Path(vault_path).resolve()}:{job_id}",
        job_id=job_id,
        max_attempts=DEFAULT_MAX_ATTEMPTS,
    )
    if launch:
        _launch(vault_path, job_id, model_call=model_call or _default_model_call)
    return _public_job(job)


def estimate_analysis(
    vault_path: Path,
    raw_scope: Any,
    *,
    language: str = "Catalan",
    guidance: str = "",
) -> Dict[str, Any]:
    """Return a deterministic no-model estimate for one Reader analysis."""
    scope = normalize_scope("reader", raw_scope)
    scope["include_full_content"] = True
    rows = _snapshot_articles(Path(vault_path), scope)
    batches = _build_batches(rows)
    return {
        "estimate_only": True,
        "record_count": len(rows),
        "batch_count": len(batches),
        "estimated_model_calls": len(batches) + (1 if batches else 0),
        "language": str(language or "Catalan")[:64],
        "guidance_chars": len(str(guidance or "")[:MAX_GUIDANCE_CHARS]),
        "scope": scope,
    }


def list_analyses(vault_path: Path, limit: int = 20) -> List[Dict[str, Any]]:
    """List recent durable Reader jobs without exposing checkpoint internals."""
    jobs_dir = _root(vault_path) / "jobs"
    if not jobs_dir.exists():
        return []
    jobs = [job for path in jobs_dir.glob("*.json") if isinstance((job := _load_json(path)), dict)]
    jobs.sort(key=lambda job: str(job.get("created_at") or ""), reverse=True)
    visible = []
    for job in jobs[: max(1, min(int(limit), 100))]:
        try:
            visible.append(get_status(vault_path, str(job.get("job_id") or "")))
        except (KeyError, ValueError):
            continue
    return visible


def get_status(vault_path: Path, job_id: str) -> Dict[str, Any]:
    """Return durable job state, marking orphaned running jobs interrupted."""
    job_id = _validate_job_id(job_id)
    durable_job_queue.reconcile_expired()
    launch_due = False
    with _LOCK:
        job = _load_json(_job_path(vault_path, job_id))
        if not isinstance(job, dict):
            raise KeyError(job_id)
        thread = _THREADS.get(job_id)
        if job.get("state") in RUNNING_STATES and not (thread and thread.is_alive()):
            job = _save_job(
                vault_path,
                {
                    **job,
                    "state": "interrupted",
                    "phase": "interrupted",
                    "error": "The backend stopped before the job completed. Resume the job.",
                },
            )
        elif job.get("state") == "retry_wait" and not (thread and thread.is_alive()):
            retry = _retry_policy(job)
            retry_at = _parse_utc(retry.get("next_retry_at"))
            launch_due = retry_at is None or retry_at <= datetime.now(timezone.utc)
        public = _public_job(job)
    if launch_due:
        _launch(vault_path, job_id, model_call=_default_model_call)
    return public


def read_result(vault_path: Path, job_id: str) -> Dict[str, Any]:
    """Return the structured result and report for one completed job."""
    status = get_status(vault_path, job_id)
    if status.get("state") != "completed":
        raise RuntimeError(f"Reader analysis is {status.get('state')}.")
    result = _load_json(_result_path(vault_path, job_id))
    if not isinstance(result, dict):
        raise RuntimeError("Reader analysis result is missing or unreadable.")
    result["report_markdown"] = _report_path(vault_path, job_id).read_text(encoding="utf-8")
    return result


def resume_analysis(
    vault_path: Path,
    job_id: str,
    *,
    model_call: Optional[Callable[[str, str], str]] = None,
) -> Dict[str, Any]:
    """Resume an interrupted or failed job from its persisted batch checkpoints."""
    status = get_status(vault_path, job_id)
    if status.get("state") not in {"interrupted", "failed", "retry_wait"}:
        return status
    retry = _retry_policy(status)
    if (
        retry["attempt"] >= retry["max_attempts"]
        or retry["model_calls_used"] >= retry["model_call_budget"]
    ):
        raise RuntimeError("Reader analysis retry budget is exhausted.")
    _cancel_retry_timer(job_id)
    retry.update(
        {
            "next_retry_at": None,
            "last_resume_kind": "manual",
            "budget_exhausted": False,
        }
    )
    job = _update_job(
        vault_path,
        _validate_job_id(job_id),
        state="queued",
        phase="queued",
        error=None,
        cancel_requested=False,
        completed_at=None,
        retry=retry,
    )
    durable_job_queue.requeue(_validate_job_id(job_id))
    _launch(vault_path, job_id, model_call=model_call or _default_model_call)
    return _public_job(job)


def cancel_analysis(vault_path: Path, job_id: str) -> Dict[str, Any]:
    """Request cooperative cancellation between model batches."""
    job_id = _validate_job_id(job_id)
    status = get_status(vault_path, job_id)
    if status.get("state") in TERMINAL_STATES:
        return status
    _cancel_retry_timer(job_id)
    if status.get("state") == "retry_wait":
        retry = _retry_policy(status)
        retry["next_retry_at"] = None
        return _public_job(
            _update_job(
                vault_path,
                job_id,
                state="cancelled",
                phase="cancelled",
                cancel_requested=True,
                completed_at=_utc_now(),
                retry=retry,
            )
        )
    return _public_job(_update_job(vault_path, job_id, cancel_requested=True))
