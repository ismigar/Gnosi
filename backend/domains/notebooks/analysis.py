"""Durable whole-notebook analysis workers."""

from __future__ import annotations

from backend.services.agent_behavior import task_input

import json
import sqlite3
import threading
import uuid
from pathlib import Path
from typing import Any, Iterable, Optional

from backend.config.logger_config import get_logger
from backend.domains.notebooks.chat import _authorized_source_ids
from backend.domains.notebooks.repository import (
    _bounded_text,
    _connect,
    _notebook_row,
    _now,
)
from backend.domains.notebooks.state import (
    _ANALYSIS_THREADS,
    _THREAD_LOCK,
    _WRITE_LOCK,
)
from backend.services import durable_job_queue

log = get_logger(__name__)


def start_notebook_analysis(
    notebook_id: str,
    request: str,
    *,
    revision: int,
    source_ids: Optional[Iterable[str]] = None,
) -> dict[str, Any]:
    """Queue a durable hierarchical analysis over one pinned revision."""
    from backend.services.agent_execution import prepare_snapshot
    from backend.services.agent_operation_catalog import skill_id
    execution = prepare_snapshot(skill_id("notebook"))
    _notebook_row(notebook_id)
    with _connect() as connection:
        pinned_revision = connection.execute(
            """SELECT state FROM notebook_revisions
            WHERE notebook_id=? AND revision=?""",
            (notebook_id, int(revision)),
        ).fetchone()
    if pinned_revision is None or pinned_revision["state"] != "completed":
        raise ValueError("The notebook analysis revision is not complete.")
    normalized_request = _bounded_text(request, 2_000)
    if not normalized_request:
        raise ValueError("A whole-notebook analysis requires a request.")
    selected_source_ids = _authorized_source_ids(notebook_id, int(revision), source_ids)
    if selected_source_ids == []:
        raise ValueError("Select at least one source for notebook analysis.")
    analysis_id = uuid.uuid4().hex
    job_id = uuid.uuid4().hex
    from backend.services.agent_execution import create_job_run
    execution = create_job_run(execution, job_id, "notebook.analysis")
    timestamp = _now()
    with _WRITE_LOCK, _connect() as connection:
        connection.execute(
            """INSERT INTO notebook_analyses
            (notebook_id,analysis_id,revision,owner_user_id,request,state,job_id,
             source_ids_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (
                notebook_id,
                analysis_id,
                int(revision),
                execution.scope.user_id,
                normalized_request,
                "queued",
                job_id,
                json.dumps(selected_source_ids, separators=(",", ":")),
                timestamp,
                timestamp,
            ),
        )
        connection.commit()
    from backend.services.context_vars import get_active_vault_path

    active_vault_path = get_active_vault_path()
    if active_vault_path is None:
        raise RuntimeError("An active vault is required for notebook analysis")
    vault_path = active_vault_path.resolve()
    durable_job_queue.enqueue(
        "notebook_analysis",
        {
            "job_id": job_id,
            "notebook_id": notebook_id,
            "analysis_id": analysis_id,
            "revision": int(revision),
            "source_ids": selected_source_ids,
            "vault_path": str(vault_path),
            "agent_execution": execution.model_dump(),
        },
        idempotency_key=f"notebook-analysis:{notebook_id}:{analysis_id}",
        job_id=job_id,
        max_attempts=3,
    )
    launch_analysis(vault_path, job_id)
    return get_notebook_analysis(notebook_id, analysis_id, revision=revision)


def get_notebook_analysis(
    notebook_id: str,
    analysis_id: str,
    *,
    revision: int,
    include_result: bool = False,
) -> dict[str, Any]:
    with _connect() as connection:
        row = connection.execute(
            """SELECT * FROM notebook_analyses WHERE notebook_id=?
            AND analysis_id=? AND revision=?""",
            (notebook_id, str(analysis_id), int(revision)),
        ).fetchone()
    if row is None:
        raise KeyError("Notebook analysis was not found in the pinned revision.")
    payload = {
        "notebook_id": notebook_id,
        "analysis_id": row["analysis_id"],
        "revision": int(row["revision"]),
        "request": row["request"],
        "state": row["state"],
        "error": row["error"],
        "job_id": row["job_id"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "result_available": bool(row["result"]),
        "source_selection": (
            "selected" if json.loads(row["source_ids_json"]) is not None else "all"
        ),
    }
    if include_result and row["result"]:
        try:
            payload["result"] = json.loads(row["result"])
        except (TypeError, ValueError):
            payload["result"] = {"text": str(row["result"])}
    return payload


def _analysis_batches(rows: list[sqlite3.Row], max_chars: int = 32_000) -> list[list[sqlite3.Row]]:
    batches: list[list[sqlite3.Row]] = []
    current: list[sqlite3.Row] = []
    current_chars = 0
    for row in rows:
        size = len(str(row["text"] or "")) + 500
        if current and current_chars + size > max_chars:
            batches.append(current)
            current = []
            current_chars = 0
        current.append(row)
        current_chars += size
    if current:
        batches.append(current)
    return batches


def _model_analysis(prompt: str, request: str) -> str:
    from functools import partial
    from backend.services.agent_execution import generate_for

    generate_text = partial(generate_for, "notebook")

    text, _model = generate_text(prompt, user_message=request, timeout=120)
    return str(text or "").strip()


def _run_analysis(vault_path: Path, job_id: str, worker_id: str) -> dict[str, Any]:
    from backend.services.agent_execution import operation_session
    from backend.services.agent_execution_models import AgentExecutionSnapshot
    item = durable_job_queue.get(job_id)
    payload = item.get("payload", {}) if isinstance(item, dict) else {}
    if not payload.get("agent_execution"):
        raise RuntimeError("agent_job_requires_authorized_restart")
    snapshot = AgentExecutionSnapshot.model_validate(payload["agent_execution"])
    if Path(snapshot.scope.vault_path).resolve() != Path(vault_path).resolve():
        raise PermissionError("agent_execution_vault_mismatch")
    from backend.services import agent_execution_store
    agent_execution_store.update(snapshot.scope, job_id, status="running")
    with operation_session(snapshot):
        try:
            result = _run_scoped_analysis(vault_path, job_id, worker_id)
            agent_execution_store.update(snapshot.scope, job_id, status="completed", result=str(result.get("text") or ""))
            return result
        except BaseException as error:
            from backend.services.agent_cancellation import AgentTurnCancelled
            agent_execution_store.update(snapshot.scope, job_id, status="cancelled" if isinstance(error, AgentTurnCancelled) else "failed", error=type(error).__name__)
            raise


def _run_scoped_analysis(vault_path: Path, job_id: str, worker_id: str) -> dict[str, Any]:
    item = durable_job_queue.get(job_id)
    payload = item.get("payload") if isinstance(item, dict) else None
    if not isinstance(payload, dict):
        raise RuntimeError("Notebook analysis payload is unavailable.")
    notebook_id = str(payload["notebook_id"])
    analysis_id = str(payload["analysis_id"])
    revision = int(payload["revision"])
    source_ids = payload.get("source_ids")
    selected_source_ids = (
        [str(value) for value in source_ids] if isinstance(source_ids, list) else None
    )
    from backend.services.context_vars import active_vault_path

    token = active_vault_path.set(Path(vault_path).resolve())
    try:
        with _WRITE_LOCK, _connect() as connection:
            analysis = connection.execute(
                """SELECT * FROM notebook_analyses WHERE notebook_id=?
                AND analysis_id=? AND revision=?""",
                (notebook_id, analysis_id, revision),
            ).fetchone()
            if analysis is None:
                raise RuntimeError("Notebook analysis record is unavailable.")
            connection.execute(
                """UPDATE notebook_analyses SET state='mapping',updated_at=?
                WHERE notebook_id=? AND analysis_id=?""",
                (_now(), notebook_id, analysis_id),
            )
            source_clause = ""
            source_params: tuple[str, ...] = ()
            if selected_source_ids is not None:
                source_clause = (
                    " AND c.source_id IN (" + ",".join("?" for _item in selected_source_ids) + ")"
                )
                source_params = tuple(selected_source_ids)
            rows = connection.execute(
                f"""SELECT c.*,s.label,s.kind FROM notebook_chunks c
                JOIN notebook_sources s ON s.notebook_id=c.notebook_id
                  AND s.revision=c.revision AND s.source_id=c.source_id
                JOIN notebook_resources r ON r.notebook_id=c.notebook_id
                  AND r.resource_id=c.resource_id
                WHERE c.notebook_id=? AND c.revision=?
                  AND s.status IN ('available','stale')
                  {source_clause}
                ORDER BY c.resource_id,c.source_id,c.ordinal""",
                (notebook_id, revision, *source_params),
            ).fetchall()
            unavailable_sources = [dict(row) for row in connection.execute(
                """SELECT s.source_id,s.label,s.status,s.error FROM notebook_sources s
                WHERE s.notebook_id=? AND s.revision=? AND s.status NOT IN ('available','stale')"""
                + source_clause.replace("c.source_id", "s.source_id"),
                (notebook_id, revision, *source_params),
            ).fetchall()]
            connection.commit()
        if not rows:
            raise RuntimeError("The pinned notebook revision has no available evidence.")
        request_text = str(analysis["request"])
        from backend.services.agent_execution import _snapshot
        execution = _snapshot.get()
        if execution is not None and execution.behavior_resources:
            from backend.services.agent_document_work import synthesize
            outcome = synthesize("notebook", [
                {"id": str(row["chunk_id"]), "text": str(row["text"]), "source": str(row["label"]), "resource_id": str(row["resource_id"])}
                for row in rows
            ], task_input("notebook.analyze", request=request_text, unavailable_sources=unavailable_sources), snapshot=execution,
                output_schema={"type": "object", "required": ["text"], "properties": {"text": {"type": "string", "minLength": 1}}},
                heartbeat=lambda: durable_job_queue.heartbeat(job_id, worker_id, lease_seconds=600))
            result = {**outcome["result"], "revision": revision, "batch_count": len(outcome["read_parts"]),
                      "chunk_ids": list(dict.fromkeys(citation["source_id"] for citation in outcome["citations"])),
                      "citations": outcome["citations"], "coverage_complete": outcome["coverage_complete"] and not unavailable_sources,
                      "unavailable_sources": unavailable_sources}
        else:
            mapped: list[dict[str, Any]] = []
            batches = _analysis_batches(list(rows))
            for index, batch in enumerate(batches, start=1):
                evidence = [
                    {
                        "chunk_id": row["chunk_id"],
                        "resource_id": row["resource_id"],
                        "source": row["label"],
                        "text": row["text"],
                    }
                    for row in batch
                ]
                prompt = task_input("notebook.batch", request=request_text, evidence=evidence)
                summary = _model_analysis(prompt, request_text)
                mapped.append(
                    {
                        "batch": index,
                        "summary": summary[:16_000],
                        "chunk_ids": [str(row["chunk_id"]) for row in batch],
                    }
                )
                durable_job_queue.heartbeat(job_id, worker_id, lease_seconds=600)
            with _WRITE_LOCK, _connect() as connection:
                connection.execute(
                    """UPDATE notebook_analyses SET state='reducing',updated_at=?
                    WHERE notebook_id=? AND analysis_id=?""",
                    (_now(), notebook_id, analysis_id),
                )
                connection.commit()
            current = mapped
            while len(json.dumps(current, ensure_ascii=False)) > 44_000 or len(current) > 6:
                reduced: list[dict[str, Any]] = []
                for offset in range(0, len(current), 4):
                    group = current[offset : offset + 4]
                    prompt = task_input("notebook.combine", request=request_text, summaries=group)
                    reduced.append(
                        {
                            "summary": _model_analysis(prompt, request_text)[:20_000],
                            "chunk_ids": list(
                                dict.fromkeys(
                                    chunk_id for item in group for chunk_id in item.get("chunk_ids", [])
                                )
                            )[:200],
                        }
                    )
                current = reduced
            final_prompt = task_input("notebook.final", request=request_text, summaries=current)
            final_text = _model_analysis(final_prompt, request_text)
            cited_chunk_ids = list(
                dict.fromkeys(chunk_id for item in mapped for chunk_id in item["chunk_ids"])
            )[:300]
            result = {
                "text": final_text[:60_000],
                "revision": revision,
                "batch_count": len(batches),
                "chunk_ids": cited_chunk_ids,
            }
        with _WRITE_LOCK, _connect() as connection:
            connection.execute(
                """UPDATE notebook_analyses SET state='completed',result=?,error=NULL,
                updated_at=? WHERE notebook_id=? AND analysis_id=?""",
                (
                    json.dumps(result, ensure_ascii=False, separators=(",", ":")),
                    _now(),
                    notebook_id,
                    analysis_id,
                ),
            )
            connection.commit()
        return {"notebook_id": notebook_id, "analysis_id": analysis_id, **result}
    finally:
        active_vault_path.reset(token)


def _analysis_thread(vault_path: Path, job_id: str) -> None:
    worker_id = f"notebook-analysis:{uuid.uuid4().hex[:12]}"
    try:
        if not durable_job_queue.claim(job_id, worker_id=worker_id, lease_seconds=600):
            return
        result = _run_analysis(vault_path, job_id, worker_id)
        durable_job_queue.complete(job_id, worker_id, result)
    except Exception as exc:  # noqa: BLE001
        log.exception("Notebook analysis failed for durable job %s", job_id)
        durable_job_queue.fail(job_id, worker_id, exc)
        item = durable_job_queue.get(job_id)
        payload = item.get("payload") if isinstance(item, dict) else {}
        with _WRITE_LOCK, _connect() as connection:
            connection.execute(
                """UPDATE notebook_analyses SET state=?,error=?,updated_at=?
                WHERE notebook_id=? AND analysis_id=?""",
                (
                    "interrupted" if str(exc) == "agent_job_requires_authorized_restart" else "failed",
                    _bounded_text(exc, 2_000),
                    _now(),
                    str((payload or {}).get("notebook_id") or ""),
                    str((payload or {}).get("analysis_id") or ""),
                ),
            )
            connection.commit()
    finally:
        with _THREAD_LOCK:
            _ANALYSIS_THREADS.pop(job_id, None)


def launch_analysis(vault_path: Path, job_id: str) -> None:
    with _THREAD_LOCK:
        existing = _ANALYSIS_THREADS.get(job_id)
        if existing and existing.is_alive():
            return
        thread = threading.Thread(
            target=_analysis_thread,
            args=(Path(vault_path).resolve(), str(job_id)),
            name=f"notebook-analysis-{str(job_id)[:8]}",
            daemon=True,
        )
        _ANALYSIS_THREADS[job_id] = thread
        thread.start()
