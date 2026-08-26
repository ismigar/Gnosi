"""Durable hierarchical analysis for large Reader collections."""
from __future__ import annotations

import hashlib
import json
import re
import threading
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional

from sqlalchemy.orm import joinedload

from backend.agent.internal_sources import normalize_internal_scope
from backend.config.app_config import load_params
from backend.config.logger_config import get_logger
from backend.utils.safe_io import safe_write_json, safe_write_text
from backend.services import durable_job_queue
from backend.security.secret_redaction import redact_secrets


log = get_logger(__name__)

JOB_ID_RE = re.compile(r"^[a-f0-9]{32}$")
MAX_BATCH_CHARS = 36_000
MAX_REDUCE_CHARS = 48_000
MAX_GUIDANCE_CHARS = 2_000
RUNNING_STATES = {"queued", "snapshotting", "mapping", "reducing"}
TERMINAL_STATES = {"completed", "failed", "cancelled", "interrupted"}
DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_RETRY_BASE_SECONDS = 2
DEFAULT_RETRY_MAX_SECONDS = 30
DEFAULT_MODEL_CALL_BUDGET = 64

_THREADS: Dict[str, threading.Thread] = {}
_RETRY_TIMERS: Dict[str, threading.Timer] = {}
_LOCK = threading.RLock()


class JobRetryBudgetError(RuntimeError):
    """Raised before a model call would exceed the persisted job budget."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _vault_key(vault_path: Path) -> str:
    return hashlib.sha256(str(Path(vault_path).resolve()).encode("utf-8")).hexdigest()[:20]


def _root(vault_path: Path) -> Path:
    local_data = Path(load_params(strict_env=False).paths["LOCAL_DATA"])
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
    policy["base_delay_seconds"] = max(
        0, min(int(policy.get("base_delay_seconds") or 0), 3_600)
    )
    policy["max_delay_seconds"] = max(
        policy["base_delay_seconds"],
        min(int(policy.get("max_delay_seconds") or 0), 86_400),
    )
    policy["model_call_budget"] = max(
        1, min(int(policy.get("model_call_budget") or 1), 10_000)
    )
    policy["model_calls_used"] = max(
        0, int(policy.get("model_calls_used") or 0)
    )
    policy["budget_exhausted"] = bool(
        policy["attempt"] >= policy["max_attempts"]
        or policy["model_calls_used"] >= policy["model_call_budget"]
    )
    return policy


def _is_transient_failure(error: BaseException) -> bool:
    if isinstance(error, (TimeoutError, ConnectionError)):
        return True
    normalized = str(error or "").casefold()
    return any(marker in normalized for marker in (
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
    ))


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


def _article_text(article: Any) -> str:
    from backend.agent.internal_sources import _plain_text

    return _plain_text(
        article.full_content or article.content or "",
        None,
    )


def _snapshot_articles(vault_path: Path, scope: Dict[str, Any]) -> List[Dict[str, Any]]:
    from backend.agent.internal_sources import _apply_reader_scope
    from backend.data.db import get_engine_for_path
    from backend.models.reader import Article

    _engine, session_factory = get_engine_for_path(vault_path)
    db = session_factory()
    try:
        query = db.query(Article).options(joinedload(Article.source))
        query = _apply_reader_scope(query, scope)
        rows = query.order_by(Article.published_at.asc(), Article.id.asc()).all()
        return [
            {
                "id": str(article.id),
                "title": str(article.title or "")[:1_000],
                "source_id": article.source_id,
                "source": str(getattr(article.source, "name", "") or ""),
                "category": str(getattr(article.source, "category", "") or "Uncategorized"),
                "published_at": article.published_at.isoformat() if article.published_at else None,
                "url": str(article.url or "")[:2_000],
                "is_read": bool(article.is_read),
                "content": _article_text(article),
            }
            for article in rows
        ]
    finally:
        db.close()


def _digest_snapshot(rows: List[Dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for row in rows:
        digest.update(json.dumps(row, ensure_ascii=True, sort_keys=True).encode("utf-8"))
    return digest.hexdigest()


def _topic_for(row: Dict[str, Any]) -> str:
    category = str(row.get("category") or "").strip()
    if category and category.casefold() not in {"uncategorized", "sense categoria"}:
        return category
    return str(row.get("source") or "Uncategorized").strip() or "Uncategorized"


def _build_batches(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        metadata = {**row, "content": ""}
        metadata_chars = len(json.dumps(metadata, ensure_ascii=False))
        content_chars = max(4_000, MAX_BATCH_CHARS - metadata_chars - 1_000)
        content = str(row.get("content") or "")
        if len(content) <= content_chars:
            grouped[_topic_for(row)].append(row)
            continue
        part_count = (len(content) + content_chars - 1) // content_chars
        for part_index, offset in enumerate(range(0, len(content), content_chars)):
            grouped[_topic_for(row)].append({
                **row,
                "content": content[offset:offset + content_chars],
                "content_offset": offset,
                "content_char_count": len(content),
                "content_part": part_index + 1,
                "content_parts": part_count,
            })

    batches: List[Dict[str, Any]] = []
    for topic in sorted(grouped, key=str.casefold):
        current: List[Dict[str, Any]] = []
        current_chars = 0
        for row in grouped[topic]:
            encoded_chars = len(json.dumps(row, ensure_ascii=False))
            if current and current_chars + encoded_chars > MAX_BATCH_CHARS:
                batches.append({"topic": topic, "articles": current})
                current = []
                current_chars = 0
            current.append(row)
            current_chars += encoded_chars
        if current:
            batches.append({"topic": topic, "articles": current})
    return batches


def _extract_json(text: str) -> Optional[Dict[str, Any]]:
    body = str(text or "").strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", body, re.DOTALL)
    candidate = fenced.group(1) if fenced else body
    if not candidate.startswith("{"):
        match = re.search(r"\{.*\}", candidate, re.DOTALL)
        candidate = match.group(0) if match else ""
    try:
        parsed = json.loads(candidate)
    except (TypeError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _default_model_call(prompt: str, user_message: str) -> str:
    from backend.agent.factory import generate_text

    text, _model = generate_text(prompt, user_message=user_message, timeout=120)
    return text


def _fallback_batch_summary(batch: Dict[str, Any]) -> Dict[str, Any]:
    articles = batch["articles"]
    article_ids = list(dict.fromkeys(item["id"] for item in articles))
    first = articles[0]
    last = articles[-1]
    titles = [str(item.get("title") or "") for item in articles[:12]]
    return {
        "topic": batch["topic"],
        "period_start": first.get("published_at"),
        "period_end": last.get("published_at"),
        "article_count": len(article_ids),
        "summary": "; ".join(title for title in titles if title)[:4_000],
        "developments": [],
        "article_ids": article_ids[:20],
        "_article_ids_all": article_ids,
        "fallback": True,
    }


def _map_batch(
    batch: Dict[str, Any],
    *,
    language: str,
    guidance: str,
    model_call: Callable[[str, str], str],
) -> Dict[str, Any]:
    articles = batch["articles"]
    prompt = (
        "You are analysing one chronological batch from a Reader collection "
        "to answer the user's request. "
        f"Canonical topic: {batch['topic']}. Output language: {language}. "
        "Every supplied article belongs to this batch. Return only JSON with keys "
        "topic, period_start, period_end, article_count, summary, developments, "
        "and article_ids. developments must be a chronological list of concise "
        "changes, each with date, claim, and supporting article_ids. Do not invent "
        "facts or identifiers. Keep representative article_ids from the input."
        " An article may span multiple content parts; integrate every supplied "
        "part with the same id before drawing conclusions."
    )
    if guidance:
        prompt += f"\nUSER READER REQUEST:\n{guidance}"
    prompt += "\nARTICLES:\n" + "\n".join(
        json.dumps(item, ensure_ascii=False) for item in articles
    )
    parsed = _extract_json(model_call(prompt, "Analyse this Reader batch for the request"))
    if not parsed:
        return _fallback_batch_summary(batch)
    all_article_ids = list(dict.fromkeys(item["id"] for item in articles))
    allowed_ids = set(all_article_ids)
    ids = [
        str(value)
        for value in parsed.get("article_ids") or []
        if str(value) in allowed_ids
    ][:50]
    developments = []
    for item in parsed.get("developments") or []:
        if not isinstance(item, dict):
            continue
        developments.append({
            "date": str(item.get("date") or "")[:100],
            "claim": str(item.get("claim") or "")[:2_000],
            "article_ids": [
                str(value)
                for value in item.get("article_ids") or []
                if str(value) in allowed_ids
            ][:20],
        })
    return {
        "topic": batch["topic"],
        "period_start": articles[0].get("published_at"),
        "period_end": articles[-1].get("published_at"),
        "article_count": len(all_article_ids),
        "summary": str(parsed.get("summary") or "")[:6_000],
        "developments": developments[:30],
        "article_ids": ids or all_article_ids[:20],
        "_article_ids_all": all_article_ids,
        "fallback": False,
    }


def _reduce_once(
    topic: str,
    summaries: List[Dict[str, Any]],
    *,
    language: str,
    guidance: str,
    model_call: Callable[[str, str], str],
) -> Dict[str, Any]:
    allowed_ids = {
        str(identifier)
        for summary in summaries
        for identifier in (
            summary.get("_article_ids_all")
            or summary.get("article_ids")
            or []
        )
    }
    model_summaries = [
        {
            key: value
            for key, value in summary.items()
            if key != "_article_ids_all"
        }
        for summary in summaries
    ]
    prompt = (
        f"Combine chronological batch analyses for the canonical news topic "
        f"{topic!r}. Output language: {language}. Return only JSON with keys "
        "topic, evolution, turning_points, and article_ids. Preserve chronology, "
        "answer the user's Reader request, distinguish sustained trends from "
        "one-off events when relevant, and cite only supplied article ids. Do "
        "not invent evidence.\nUSER READER REQUEST:\n"
        + (guidance or "Provide a faithful synthesis of the selected collection.")
        + "\nBATCH ANALYSES:\n"
        + json.dumps(model_summaries, ensure_ascii=False)
    )
    parsed = _extract_json(model_call(prompt, "Synthesize this Reader topic for the request"))
    if not parsed:
        return {
            "topic": topic,
            "evolution": "\n\n".join(
                str(item.get("summary") or "") for item in summaries
            )[:12_000],
            "turning_points": [
                development
                for item in summaries
                for development in item.get("developments") or []
            ][:100],
            "article_ids": list(allowed_ids)[:100],
            "_article_ids_all": sorted(allowed_ids),
            "fallback": True,
        }
    ids = [
        str(value)
        for value in parsed.get("article_ids") or []
        if str(value) in allowed_ids
    ][:100]
    return {
        "topic": topic,
        "evolution": str(parsed.get("evolution") or "")[:12_000],
        "turning_points": list(parsed.get("turning_points") or [])[:100],
        "article_ids": ids or list(allowed_ids)[:100],
        "_article_ids_all": sorted(allowed_ids),
        "fallback": False,
    }


def _reduce_topic(
    topic: str,
    summaries: List[Dict[str, Any]],
    *,
    language: str,
    guidance: str,
    model_call: Callable[[str, str], str],
) -> Dict[str, Any]:
    current: List[Dict[str, Any]] = summaries
    while len(json.dumps(current, ensure_ascii=False)) > MAX_REDUCE_CHARS:
        reduced: List[Dict[str, Any]] = []
        chunk: List[Dict[str, Any]] = []
        chunk_chars = 0
        for summary in current:
            size = len(json.dumps(summary, ensure_ascii=False))
            if chunk and chunk_chars + size > MAX_REDUCE_CHARS:
                reduced.append(_reduce_once(
                    topic,
                    chunk,
                    language=language,
                    guidance=guidance,
                    model_call=model_call,
                ))
                chunk = []
                chunk_chars = 0
            chunk.append(summary)
            chunk_chars += size
        if chunk:
            reduced.append(_reduce_once(
                topic,
                chunk,
                language=language,
                guidance=guidance,
                model_call=model_call,
            ))
        current = reduced
    result = _reduce_once(
        topic,
        current,
        language=language,
        guidance=guidance,
        model_call=model_call,
    )
    result["article_count"] = len({
        str(identifier)
        for summary in summaries
        for identifier in (
            summary.get("_article_ids_all")
            or summary.get("article_ids")
            or []
        )
    })
    result["period_start"] = summaries[0].get("period_start")
    result["period_end"] = summaries[-1].get("period_end")
    result.pop("_article_ids_all", None)
    return result


def _render_report(result: Dict[str, Any]) -> str:
    lines = [
        "# Reader analysis",
        "",
        f"Request: {result.get('request') or 'General collection synthesis'}",
        "",
        f"Articles analysed: {result['article_count']}",
        f"Snapshot: `{result['snapshot_digest']}`",
        "",
    ]
    for topic in result["topics"]:
        lines.extend([
            f"## {topic['topic']}",
            "",
            str(topic.get("evolution") or "No summary was produced."),
            "",
            (
                f"Period: {topic.get('period_start') or 'unknown'} — "
                f"{topic.get('period_end') or 'unknown'} · "
                f"Articles: {topic.get('article_count') or 0}"
            ),
            "",
        ])
        ids = list(topic.get("article_ids") or [])[:20]
        if ids:
            lines.append("Evidence: " + ", ".join(
                f"[Reader #{identifier}](/reader?article={identifier})"
                for identifier in ids
            ))
            lines.append("")
    return "\n".join(lines).strip() + "\n"


def _cancel_requested(vault_path: Path, job_id: str) -> bool:
    job = _load_json(_job_path(vault_path, job_id)) or {}
    return bool(job.get("cancel_requested"))


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
        job = _update_job(
            vault_path,
            job_id,
            state="snapshotting",
            phase="snapshotting",
            progress=1,
            error=None,
            completed_at=None,
            retry=retry,
        )

        def budgeted_model_call(prompt: str, user_message: str) -> str:
            if worker_id:
                durable_job_queue.heartbeat(job_id, worker_id)
            _consume_model_call_budget(vault_path, job_id)
            return model_call(prompt, user_message)

        snapshot = _load_json(_snapshot_path(vault_path, job_id))
        if not isinstance(snapshot, list):
            snapshot = _snapshot_articles(vault_path, dict(job.get("scope") or {}))
            snapshot_digest = _digest_snapshot(snapshot)
            safe_write_json(_snapshot_path(vault_path, job_id), snapshot)
        else:
            snapshot_digest = str(job.get("snapshot_digest") or "")
            if not snapshot_digest:
                snapshot_digest = _digest_snapshot(snapshot)
        job = _update_job(
            vault_path,
            job_id,
            state="mapping",
            phase="mapping",
            progress=2,
            total_articles=len(snapshot),
            snapshot_digest=snapshot_digest,
        )
        if _cancel_requested(vault_path, job_id):
            _update_job(
                vault_path,
                job_id,
                state="cancelled",
                phase="cancelled",
                completed_at=_utc_now(),
            )
            return
        batches = _build_batches(snapshot)
        _update_job(vault_path, job_id, total_batches=len(batches))
        summaries: List[Dict[str, Any]] = []
        for index, batch in enumerate(batches):
            if _cancel_requested(vault_path, job_id):
                _update_job(
                    vault_path,
                    job_id,
                    state="cancelled",
                    phase="cancelled",
                    completed_at=_utc_now(),
                )
                return
            checkpoint_path = _checkpoint_path(vault_path, job_id, index)
            summary = _load_json(checkpoint_path)
            if not isinstance(summary, dict):
                summary = _map_batch(
                    batch,
                    language=str(job["language"]),
                    guidance=str(job.get("guidance") or ""),
                    model_call=budgeted_model_call,
                )
                safe_write_json(checkpoint_path, summary)
            summaries.append(summary)
            processed = len({
                str(identifier)
                for item in summaries
                for identifier in (
                    item.get("_article_ids_all")
                    or item.get("article_ids")
                    or []
                )
            })
            _update_job(
                vault_path,
                job_id,
                completed_batches=index + 1,
                processed_articles=processed,
                progress=max(3, min(80, int(((index + 1) / max(1, len(batches))) * 80))),
            )
            if worker_id:
                durable_job_queue.heartbeat(job_id, worker_id)

        _update_job(vault_path, job_id, state="reducing", phase="reducing", progress=82)
        by_topic: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for summary in summaries:
            by_topic[str(summary.get("topic") or "Uncategorized")].append(summary)
        topics = [
            _reduce_topic(
                topic,
                by_topic[topic],
                language=str(job["language"]),
                guidance=str(job.get("guidance") or ""),
                model_call=budgeted_model_call,
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
                **_retry_policy(
                    _load_json(_job_path(vault_path, job_id)) or {}
                ),
                "next_retry_at": None,
                "last_retry_reason": None,
            },
        )
    except Exception as error:  # noqa: BLE001
        log.exception("Reader analysis job %s failed", job_id)
        current = _load_json(_job_path(vault_path, job_id)) or {}
        retry = _retry_policy(current)
        transient = _is_transient_failure(error)
        can_retry = bool(
            transient
            and retry.get("automatic_enabled")
            and retry["attempt"] < retry["max_attempts"]
            and retry["model_calls_used"] < retry["model_call_budget"]
            and not current.get("cancel_requested")
        )
        if can_retry:
            retry_delay_seconds = min(
                retry["max_delay_seconds"],
                retry["base_delay_seconds"] * (2 ** max(0, retry["attempt"] - 1)),
            )
            retry.update({
                "next_retry_at": (
                    datetime.now(timezone.utc)
                    + timedelta(seconds=retry_delay_seconds)
                ).isoformat(),
                "last_retry_reason": type(error).__name__,
                "last_resume_kind": "automatic",
                "budget_exhausted": False,
            })
            _update_job(
                vault_path,
                job_id,
                state="retry_wait",
                phase="retry_wait",
                error=redact_secrets(error, max_chars=2_000),
                completed_at=None,
                retry=retry,
            )
        else:
            retry.update({
                "next_retry_at": None,
                "last_retry_reason": type(error).__name__,
                "budget_exhausted": bool(
                    retry["attempt"] >= retry["max_attempts"]
                    or retry["model_calls_used"] >= retry["model_call_budget"]
                    or isinstance(error, JobRetryBudgetError)
                ),
            })
            _update_job(
                vault_path,
                job_id,
                state="failed",
                phase="failed",
                error=redact_secrets(error, max_chars=2_000),
                completed_at=_utc_now(),
                retry=retry,
            )
    finally:
        active_vault_path.reset(vault_token)
        with _LOCK:
            _THREADS.pop(job_id, None)
        if worker_id:
            final_job = _load_json(_job_path(vault_path, job_id)) or {}
            final_state = str(final_job.get("state") or "")
            if retry_delay_seconds is not None:
                durable_job_queue.fail(
                    job_id,
                    worker_id,
                    final_job.get("error") or "retry scheduled",
                    _parse_utc((_retry_policy(final_job)).get("next_retry_at")),
                )
            elif final_state in TERMINAL_STATES:
                if final_state == "completed":
                    durable_job_queue.complete(job_id, worker_id, {"state": final_state})
                else:
                    durable_job_queue.fail(job_id, worker_id, final_job.get("error") or final_state)
            else:
                durable_job_queue.fail(job_id, worker_id, final_job.get("error") or "worker stopped")
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
    scope = normalize_internal_scope("reader", raw_scope)
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
    scope = normalize_internal_scope("reader", raw_scope)
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
    jobs = [
        job
        for path in jobs_dir.glob("*.json")
        if isinstance((job := _load_json(path)), dict)
    ]
    jobs.sort(key=lambda job: str(job.get("created_at") or ""), reverse=True)
    visible = []
    for job in jobs[:max(1, min(int(limit), 100))]:
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
            job = _save_job(vault_path, {
                **job,
                "state": "interrupted",
                "phase": "interrupted",
                "error": "The backend stopped before the job completed. Resume the job.",
            })
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
    retry.update({
        "next_retry_at": None,
        "last_resume_kind": "manual",
        "budget_exhausted": False,
    })
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
        return _public_job(_update_job(
            vault_path,
            job_id,
            state="cancelled",
            phase="cancelled",
            cancel_requested=True,
            completed_at=_utc_now(),
            retry=retry,
        ))
    return _public_job(_update_job(vault_path, job_id, cancel_requested=True))
