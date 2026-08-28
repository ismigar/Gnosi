"""Durable academic repository and saved-review synchronization."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, HTTPException

from backend.config.logger_config import get_logger
from backend.domains.literature.repositories import _sync_summary, catalog
from backend.domains.literature.search import _read_search, start_search
from backend.domains.literature.state import (
    _INDEX_LOCK,
    _REVIEW_THREADS,
    _SEARCH_TASKS,
    _SYNC_THREADS,
)
from backend.domains.literature.storage import _connect_index, _now, _primary_vault, _scope
from backend.services import academic_connectors, durable_job_queue
from backend.services.literature_models import deterministic_key, normalize_title

log = get_logger(__name__)


def _source_definition(vault_path: Path | str, source_id: str) -> dict[str, Any]:
    source = next((item for item in catalog(vault_path) if item["id"] == source_id), None)
    if source is None:
        raise HTTPException(status_code=404, detail="Academic source not found.")
    if source.get("kind") != "oai":
        raise HTTPException(
            status_code=400, detail="Only OAI repositories create local synchronization jobs."
        )
    return source


def enqueue_sync(vault_path: Path | str, source_id: str, *, full: bool = False) -> dict[str, Any]:
    _source_definition(vault_path, source_id)
    job_id = uuid.uuid4().hex
    with _INDEX_LOCK, _connect_index(vault_path) as connection:
        current = connection.execute(
            "SELECT * FROM oai_sync_state WHERE source_id=?", (source_id,)
        ).fetchone()
        if current and current["state"] in {"queued", "running"}:
            return dict(current)
        connection.execute(
            """INSERT INTO oai_sync_state(
            source_id,state,job_id,resumption_token,last_successful_datestamp,
            received_count,indexed_count,deleted_count,cancel_requested,error,
            started_at,updated_at,completed_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(source_id) DO UPDATE SET state=excluded.state,
            job_id=excluded.job_id,resumption_token=CASE WHEN ? THEN ''
            ELSE oai_sync_state.resumption_token END,received_count=0,
            indexed_count=0,deleted_count=0,cancel_requested=0,error=NULL,
            started_at=excluded.started_at,updated_at=excluded.updated_at,
            completed_at=NULL""",
            (
                source_id,
                "queued",
                job_id,
                "",
                None,
                0,
                0,
                0,
                0,
                None,
                _now(),
                _now(),
                None,
                1 if full else 0,
            ),
        )
        connection.commit()
    durable_job_queue.enqueue(
        "academic_repository_sync",
        {
            "vault_path": str(_primary_vault(vault_path)),
            "source_id": source_id,
            "job_id": job_id,
            "full": bool(full),
        },
        idempotency_key=f"literature-sync:{_scope(vault_path)}:{source_id}:{job_id}",
        job_id=job_id,
        max_attempts=5,
    )
    launch_sync(_primary_vault(vault_path), source_id, job_id, full=bool(full))
    return sync_status(vault_path, source_id)


def sync_status(vault_path: Path | str, source_id: str) -> dict[str, Any]:
    return {"source_id": source_id, **_sync_summary(vault_path, source_id)}


def cancel_sync(vault_path: Path | str, source_id: str) -> dict[str, Any]:
    _source_definition(vault_path, source_id)
    with _INDEX_LOCK, _connect_index(vault_path) as connection:
        connection.execute(
            """UPDATE oai_sync_state SET state='cancelled',cancel_requested=1,
            completed_at=?,updated_at=? WHERE source_id=?
            AND state IN ('queued','running')""",
            (_now(), _now(), source_id),
        )
        connection.commit()
    return sync_status(vault_path, source_id)


def _upsert_oai_page(
    connection: sqlite3.Connection, source_id: str, page: dict[str, Any]
) -> tuple[int, int]:
    indexed = 0
    deleted = 0
    for provider_id in page.get("deleted") or []:
        row = connection.execute(
            "SELECT rowid FROM oai_records WHERE source_id=? AND provider_id=?",
            (source_id, provider_id),
        ).fetchone()
        if row:
            connection.execute("DELETE FROM oai_records_fts WHERE rowid=?", (row["rowid"],))
            connection.execute(
                "DELETE FROM oai_records WHERE source_id=? AND provider_id=?",
                (source_id, provider_id),
            )
            deleted += 1
    for work in page.get("works") or []:
        sources = work.get("sources") or []
        provider_id = str(
            (sources[0] if sources else {}).get("provider_id") or work.get("id") or ""
        )
        if not provider_id:
            continue
        current = connection.execute(
            "SELECT rowid FROM oai_records WHERE source_id=? AND provider_id=?",
            (source_id, provider_id),
        ).fetchone()
        if current:
            rowid = current["rowid"]
            connection.execute("DELETE FROM oai_records_fts WHERE rowid=?", (rowid,))
            connection.execute(
                """UPDATE oai_records SET duplicate_key=?,title=?,
                normalized_title=?,year=?,work_json=?,updated_at=?
                WHERE rowid=?""",
                (
                    deterministic_key(work),
                    work.get("title") or "",
                    normalize_title(work.get("title")),
                    work.get("year"),
                    json.dumps(work, ensure_ascii=False, separators=(",", ":")),
                    _now(),
                    rowid,
                ),
            )
        else:
            cursor = connection.execute(
                """INSERT INTO oai_records(
                source_id,provider_id,duplicate_key,title,normalized_title,
                year,work_json,updated_at) VALUES(?,?,?,?,?,?,?,?)""",
                (
                    source_id,
                    provider_id,
                    deterministic_key(work),
                    work.get("title") or "",
                    normalize_title(work.get("title")),
                    work.get("year"),
                    json.dumps(work, ensure_ascii=False, separators=(",", ":")),
                    _now(),
                ),
            )
            rowid = cursor.lastrowid
        authors = "; ".join(
            str(
                author.get("literal") or f"{author.get('given', '')} {author.get('family', '')}"
            ).strip()
            for author in work.get("authors") or []
            if isinstance(author, dict)
        )
        connection.execute(
            """INSERT INTO oai_records_fts(
            rowid,source_id,provider_id,title,abstract,authors)
            VALUES(?,?,?,?,?,?)""",
            (
                rowid,
                source_id,
                provider_id,
                work.get("title") or "",
                work.get("abstract") or "",
                authors,
            ),
        )
        indexed += 1
    return indexed, deleted


def _run_sync(vault_path: Path, source_id: str, job_id: str, full: bool) -> dict[str, Any]:
    source = _source_definition(vault_path, source_id)
    worker_id = f"literature:{os.getpid()}:{threading.get_ident()}"
    if not durable_job_queue.claim(job_id, worker_id=worker_id, lease_seconds=3_600):
        with _INDEX_LOCK, _connect_index(vault_path) as connection:
            connection.execute(
                """UPDATE oai_sync_state SET state='failed',
                error='Job claim failed or superseded',completed_at=?,updated_at=?
                WHERE source_id=? AND job_id=?""",
                (_now(), _now(), source_id, job_id),
            )
            connection.commit()
        return sync_status(vault_path, source_id)
    try:
        with _INDEX_LOCK, _connect_index(vault_path) as connection:
            state = connection.execute(
                "SELECT * FROM oai_sync_state WHERE source_id=?", (source_id,)
            ).fetchone()
            token = (
                ""
                if full
                else str((state or {}).get("resumption_token") or "")
                if isinstance(state, dict)
                else (str(state["resumption_token"] or "") if state else "")
            )
            last_success = str(state["last_successful_datestamp"] or "") if state else ""
            connection.execute(
                "UPDATE oai_sync_state SET state='running',updated_at=? WHERE source_id=?",
                (_now(), source_id),
            )
            connection.commit()
        from_date = ""
        if not full and not token and last_success:
            try:
                from_date = (
                    (
                        datetime.fromisoformat(last_success.replace("Z", "+00:00"))
                        - timedelta(days=1)
                    )
                    .date()
                    .isoformat()
                )
            except ValueError:
                from_date = ""
        while True:
            with _connect_index(vault_path) as connection:
                state = connection.execute(
                    """SELECT cancel_requested,received_count,indexed_count,
                    deleted_count FROM oai_sync_state WHERE source_id=?""",
                    (source_id,),
                ).fetchone()
            if state and state["cancel_requested"]:
                with _connect_index(vault_path) as connection:
                    connection.execute(
                        """UPDATE oai_sync_state SET state='cancelled',
                        completed_at=?,updated_at=? WHERE source_id=?""",
                        (_now(), _now(), source_id),
                    )
                    connection.commit()
                durable_job_queue.complete(job_id, worker_id, {"state": "cancelled"})
                return sync_status(vault_path, source_id)
            page = academic_connectors.run(
                academic_connectors.fetch_oai_page(
                    source, resumption_token=token, from_date=from_date
                )
            )
            with _INDEX_LOCK, _connect_index(vault_path) as connection:
                indexed, deleted = _upsert_oai_page(connection, source_id, page)
                received = (
                    int(state["received_count"] if state else 0)
                    + len(page.get("works") or [])
                    + len(page.get("deleted") or [])
                )
                indexed_total = int(state["indexed_count"] if state else 0) + indexed
                deleted_total = int(state["deleted_count"] if state else 0) + deleted
                token = str(page.get("resumption_token") or "")
                connection.execute(
                    """UPDATE oai_sync_state SET resumption_token=?,
                    received_count=?,indexed_count=?,deleted_count=?,
                    complete_list_size=?,cursor_value=?,updated_at=?
                    WHERE source_id=?""",
                    (
                        token,
                        received,
                        indexed_total,
                        deleted_total,
                        page.get("complete_list_size"),
                        page.get("cursor"),
                        _now(),
                        source_id,
                    ),
                )
                connection.commit()
            durable_job_queue.heartbeat(job_id, worker_id, lease_seconds=3_600)
            if not token:
                break
        with _connect_index(vault_path) as connection:
            connection.execute(
                """UPDATE oai_sync_state SET state='completed',
                resumption_token='',last_successful_datestamp=?,completed_at=?,
                updated_at=? WHERE source_id=?""",
                (_now(), _now(), _now(), source_id),
            )
            connection.commit()
        durable_job_queue.complete(
            job_id, worker_id, {"state": "completed", "source_id": source_id}
        )
        return sync_status(vault_path, source_id)
    except Exception as exc:  # noqa: BLE001
        log.exception("Academic OAI synchronization failed for %s", source_id)
        message = str(exc)[:2_000]
        with _connect_index(vault_path) as connection:
            connection.execute(
                """UPDATE oai_sync_state SET state='failed',error=?,
                completed_at=?,updated_at=? WHERE source_id=?""",
                (message, _now(), _now(), source_id),
            )
            connection.commit()
        durable_job_queue.fail(job_id, worker_id, message)
        return sync_status(vault_path, source_id)


def launch_sync(vault_path: Path, source_id: str, job_id: str, *, full: bool = False) -> None:
    """Launch one process-local owner for a durable OAI synchronization lease."""
    current = _SYNC_THREADS.get(job_id)
    if current and current.is_alive():
        return
    thread = threading.Thread(
        target=_run_sync,
        args=(Path(vault_path), source_id, job_id, full),
        name=f"academic-sync-{source_id}-{job_id[:6]}",
        daemon=True,
    )
    _SYNC_THREADS[job_id] = thread
    thread.start()


def enqueue_due_syncs(vault_path: Path | str | None = None) -> int:
    """Enqueue initialized OAI repositories not completed in the last 24 hours.

    The first harvest is intentionally explicit because repositories such as
    Dialnet contain hundreds of thousands of records. Once an administrator
    starts and completes that harvest, the daily scheduler owns incremental
    refreshes.
    """
    path = _primary_vault(vault_path)
    count = 0
    for source in catalog(path):
        if source.get("kind") != "oai" or not source.get("enabled"):
            continue
        completed = (source.get("sync") or {}).get("completed_at")
        if not completed:
            continue
        try:
            due = datetime.fromisoformat(str(completed).replace("Z", "+00:00")) < datetime.now(
                timezone.utc
            ) - timedelta(hours=24)
        except ValueError:
            due = True
        if due:
            enqueue_sync(path, source["id"], full=False)
            count += 1
    return count


def enqueue_due_review_updates(vault_path: Path | str | None = None) -> int:
    """Queue enabled, due review strategies as durable background jobs."""
    from backend.services import literature_review_service

    path = _primary_vault(vault_path)
    now = datetime.now(timezone.utc)
    queued = 0
    for review in literature_review_service.list_reviews():
        configuration = review.get("configuration")
        raw_schedule = configuration.get("schedule") if isinstance(configuration, dict) else {}
        schedule: dict[str, Any] = dict(raw_schedule) if isinstance(raw_schedule, dict) else {}
        raw_strategy = schedule.get("strategy")
        strategy: dict[str, Any] = dict(raw_strategy) if isinstance(raw_strategy, dict) else {}
        if not schedule.get("enabled") or not strategy.get("query"):
            continue
        next_run = str(schedule.get("next_run") or "")
        if next_run:
            try:
                if datetime.fromisoformat(next_run.replace("Z", "+00:00")) > now:
                    continue
            except ValueError:
                pass
        job_id = uuid.uuid4().hex
        durable_job_queue.enqueue(
            "academic_review_update",
            {
                "vault_path": str(path),
                "review_id": review["id"],
                "job_id": job_id,
                "strategy": strategy,
                "interval_days": max(1, min(int(schedule.get("interval_days") or 7), 365)),
            },
            idempotency_key=f"literature-review-update:{_scope(path)}:{review['id']}:{now.date().isoformat()}",
            job_id=job_id,
            max_attempts=3,
        )
        queued += 1
    return queued


def _run_review_update(
    vault_path: Path, review_id: str, job_id: str, strategy: dict[str, Any], interval_days: int
) -> dict[str, Any]:
    worker_id = f"literature-review:{os.getpid()}:{threading.get_ident()}"
    if not durable_job_queue.claim(job_id, worker_id=worker_id, lease_seconds=3_600):
        return {"state": "already_claimed"}

    async def execute() -> dict[str, Any]:
        from backend.services import literature_review_service
        from backend.services.workspace_service import WorkspaceContext

        raw_filters = strategy.get("filters")
        filters: dict[str, Any] = dict(raw_filters) if isinstance(raw_filters, dict) else {}
        created = start_search(
            vault_path,
            query=str(strategy.get("query") or ""),
            filters=filters,
            source_ids=strategy.get("source_ids")
            if isinstance(strategy.get("source_ids"), list)
            else None,
            source_queries=strategy.get("source_queries")
            if isinstance(strategy.get("source_queries"), dict)
            else None,
            limit_per_source=max(1, min(int(strategy.get("limit_per_source") or 25), 100)),
            owner_user_id="literature-scheduler",
        )
        task = _SEARCH_TASKS.get(created["id"])
        if task is not None:
            await task
        search = _read_search(vault_path, created["id"])
        context = WorkspaceContext(
            "system", "literature-scheduler", "owner", vault_path, ["read", "write"]
        )
        background_tasks = BackgroundTasks()
        activity = await literature_review_service.append_activity(
            review_id,
            "scheduled_search",
            {
                "strategy": strategy,
                "exact_queries": search.get("exact_queries") or {},
                "source_snapshot": search.get("source_snapshots") or [],
                "errors": search.get("errors") or [],
                "counts": search.get("counts")
                or {"unique_works": len(search.get("results") or [])},
                "notes": "Automated update; only newly deduplicated candidates are added.",
            },
            background_tasks,
            context,
        )
        candidates = await literature_review_service.add_candidates(
            review_id,
            search.get("results") or [],
            background_tasks,
            context,
            activity.get("id") or "",
        )
        completed = datetime.now(timezone.utc)
        updated_schedule = {
            "enabled": True,
            "interval_days": interval_days,
            "strategy": strategy,
            "last_run": completed.isoformat(),
            "next_run": (completed + timedelta(days=interval_days)).isoformat(),
            "last_search_id": created["id"],
            "last_new_count": candidates["added_count"],
        }
        await literature_review_service.update_configuration(
            review_id, {"schedule": updated_schedule}, background_tasks, context
        )
        return {
            "state": "completed",
            "search_id": created["id"],
            "new_candidates": candidates["added_count"],
            "existing_candidates": candidates["existing_count"],
        }

    try:
        raw_result = academic_connectors.run(execute())
        if not isinstance(raw_result, dict):
            raise RuntimeError("Scheduled literature review returned an invalid result.")
        result = dict(raw_result)
        durable_job_queue.complete(job_id, worker_id, result)
        return result
    except Exception as exc:  # noqa: BLE001
        log.exception("Scheduled literature review update failed for %s", review_id)
        durable_job_queue.fail(job_id, worker_id, str(exc)[:2_000])
        return {"state": "failed", "error": str(exc)[:2_000]}


def launch_review_update(
    vault_path: Path, review_id: str, job_id: str, strategy: dict[str, Any], interval_days: int = 7
) -> None:
    """Launch one process-local owner for a durable scheduled review update."""
    current = _REVIEW_THREADS.get(job_id)
    if current and current.is_alive():
        return
    thread = threading.Thread(
        target=_run_review_update,
        args=(Path(vault_path), review_id, job_id, strategy, interval_days),
        name=f"literature-review-{review_id[:6]}-{job_id[:6]}",
        daemon=True,
    )
    _REVIEW_THREADS[job_id] = thread
    thread.start()
