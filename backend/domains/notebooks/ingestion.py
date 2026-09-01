"""Durable ingestion workers for grounded notebook evidence."""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from backend.config.logger_config import get_logger
from backend.domains.notebooks.ingest_storage import (
    _copy_resource_errors,
    _copy_resource_revision,
    _insert_error_source,
    _insert_source,
)
from backend.domains.notebooks.repository import (
    _bounded_text,
    _connect,
    _notebook_row,
    _now,
)
from backend.domains.notebooks.resources import (
    _current_resource_snapshot,
    _load_url_validators,
    _probe_resource_urls,
    _prune_notebook_revisions,
    _url_refresh_due,
    _url_validators_from_origins,
    _url_values,
    resource_fingerprint,
)
from backend.domains.notebooks.state import (
    _THREAD_LOCK,
    _THREADS,
    _WRITE_LOCK,
    NotebookIngestionCancelled,
)
from backend.services import durable_job_queue, llm_wiki_extractors

log = get_logger(__name__)


@dataclass
class _IngestProgress:
    active_revision: int | None
    available_sources: int = 0
    error_sources: int = 0
    changed_any: bool = False


@dataclass
class _ResourceOutcome:
    state: str = "available"
    error: str | None = None
    fingerprint: str = ""
    url_validators: dict[str, dict[str, str]] | None = None
    url_checked_at: str | None = None


def _ingest_request(
    job_id: str,
) -> tuple[str, int, bool, set[str], dict[str, Any]]:
    item = durable_job_queue.get(job_id)
    payload = item.get("payload") if isinstance(item, dict) else None
    if not isinstance(payload, dict):
        raise RuntimeError("Notebook ingestion payload is unavailable.")
    notebook_id = str(payload.get("notebook_id") or "")
    revision = int(str(payload.get("revision") or 0))
    force_url_check = bool(payload.get("force"))
    target_resource_ids = {
        str(value) for value in payload.get("target_resource_ids") or [] if str(value).strip()
    }
    return notebook_id, revision, force_url_check, target_resource_ids, payload


def _mark_ingest_started(notebook_id: str, revision: int) -> None:
    with _WRITE_LOCK, _connect() as connection:
        connection.execute(
            "UPDATE notebook_revisions SET state='indexing' WHERE notebook_id=? AND revision=?",
            (notebook_id, revision),
        )
        connection.execute(
            "UPDATE notebooks SET status='indexing',updated_at=? WHERE id=?",
            (_now(), notebook_id),
        )
        connection.execute(
            "DELETE FROM notebook_chunks_fts WHERE notebook_id=? AND revision=?",
            (notebook_id, revision),
        )
        connection.commit()


def _set_current_resource(
    notebook_id: str,
    revision: int,
    resource_id: str,
    resource_title: str,
) -> None:
    with _WRITE_LOCK, _connect() as connection:
        connection.execute(
            """UPDATE notebook_revisions SET current_resource_id=?,
            current_resource_title=? WHERE notebook_id=? AND revision=?""",
            (resource_id, resource_title, notebook_id, revision),
        )
        connection.commit()


def _update_ingest_counters(
    connection: sqlite3.Connection,
    notebook_id: str,
    revision: int,
    index: int,
    progress: _IngestProgress,
) -> None:
    connection.execute(
        """UPDATE notebook_revisions SET processed_resources=?,
        available_sources=?,error_sources=? WHERE notebook_id=? AND revision=?""",
        (
            index,
            progress.available_sources,
            progress.error_sources,
            notebook_id,
            revision,
        ),
    )


def _copy_unselected_resource(
    connection: sqlite3.Connection,
    *,
    notebook_id: str,
    revision: int,
    resource_id: str,
    target_resource_ids: set[str],
    index: int,
    progress: _IngestProgress,
) -> bool:
    if (
        not target_resource_ids
        or resource_id in target_resource_ids
        or progress.active_revision is None
    ):
        return False
    progress.available_sources += _copy_resource_revision(
        connection,
        notebook_id=notebook_id,
        from_revision=progress.active_revision,
        to_revision=revision,
        resource_id=resource_id,
    )
    progress.error_sources += _copy_resource_errors(
        connection,
        notebook_id=notebook_id,
        from_revision=progress.active_revision,
        to_revision=revision,
        resource_id=resource_id,
    )
    _update_ingest_counters(connection, notebook_id, revision, index, progress)
    connection.commit()
    return True


def _missing_resource(
    connection: sqlite3.Connection,
    *,
    notebook_id: str,
    revision: int,
    resource_id: str,
    progress: _IngestProgress,
) -> _ResourceOutcome:
    progress.changed_any = True
    message = "The Resource no longer exists in the notebook source table."
    copied = 0
    if progress.active_revision is not None:
        copied = _copy_resource_revision(
            connection,
            notebook_id=notebook_id,
            from_revision=progress.active_revision,
            to_revision=revision,
            resource_id=resource_id,
            status="stale",
        )
    if copied:
        progress.available_sources += copied
        return _ResourceOutcome(state="stale", error=message)
    _insert_error_source(
        connection,
        notebook_id=notebook_id,
        revision=revision,
        resource_id=resource_id,
        message=message,
        ordinal=0,
    )
    progress.error_sources += 1
    return _ResourceOutcome(state="error", error=message)


def _can_reuse_resource(
    *,
    resource: sqlite3.Row,
    resource_id: str,
    fingerprint_changed: bool,
    has_url: bool,
    urls: list[str],
    force_url_check: bool,
    target_resource_ids: set[str],
    progress: _IngestProgress,
    outcome: _ResourceOutcome,
) -> bool:
    can_reuse = (
        progress.active_revision is not None
        and not fingerprint_changed
        and resource_id not in target_resource_ids
    )
    if not (can_reuse and has_url and (force_url_check or _url_refresh_due(resource, has_url))):
        return can_reuse
    try:
        changed, validators = _probe_resource_urls(
            urls,
            outcome.url_validators or {},
        )
        outcome.url_validators = validators
        outcome.url_checked_at = _now()
        progress.changed_any = progress.changed_any or changed
        return not changed
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "Notebook URL revalidation failed for Resource %s: %s",
            resource_id,
            exc,
        )
        return False


def _store_extracted_sources(
    connection: sqlite3.Connection,
    *,
    notebook_id: str,
    revision: int,
    resource_id: str,
    origins: list[dict[str, Any]],
    warnings: list[str],
    progress: _IngestProgress,
    outcome: _ResourceOutcome,
) -> None:
    for origin in origins:
        _insert_source(
            connection,
            notebook_id=notebook_id,
            revision=revision,
            resource_id=resource_id,
            origin=origin,
            status="available",
        )
        progress.available_sources += 1
    if warnings:
        outcome.error = "; ".join(warnings)[:2_000]
        for warning_index, warning in enumerate(warnings):
            _insert_error_source(
                connection,
                notebook_id=notebook_id,
                revision=revision,
                resource_id=resource_id,
                message=warning,
                ordinal=warning_index,
            )
            progress.error_sources += 1
    if origins:
        if warnings:
            outcome.state = "stale"
        return
    copied = 0
    if progress.active_revision is not None:
        copied = _copy_resource_revision(
            connection,
            notebook_id=notebook_id,
            from_revision=progress.active_revision,
            to_revision=revision,
            resource_id=resource_id,
            status="stale",
        )
    if copied:
        progress.available_sources += copied
        outcome.state = "stale"
        return
    if not warnings:
        outcome.error = "No readable attachment or URL source was found."
        _insert_error_source(
            connection,
            notebook_id=notebook_id,
            revision=revision,
            resource_id=resource_id,
            message=outcome.error,
            ordinal=0,
        )
        progress.error_sources += 1
    outcome.state = "error"


def _present_resource(
    connection: sqlite3.Connection,
    *,
    notebook_id: str,
    revision: int,
    resource: sqlite3.Row,
    resource_id: str,
    page: Any,
    table: dict[str, Any],
    source_config: dict[str, Any],
    vault_path: Path,
    force_url_check: bool,
    target_resource_ids: set[str],
    progress: _IngestProgress,
) -> _ResourceOutcome:
    outcome = _ResourceOutcome(
        url_validators=_load_url_validators(resource),
        url_checked_at=str(resource["url_checked_at"] or "") or None,
    )
    outcome.fingerprint, has_url = resource_fingerprint(
        page.metadata or {}, table, source_config, vault_path
    )
    urls = _url_values(page.metadata or {}, table, source_config)
    fingerprint_changed = outcome.fingerprint != str(resource["fingerprint"] or "")
    can_reuse = _can_reuse_resource(
        resource=resource,
        resource_id=resource_id,
        fingerprint_changed=fingerprint_changed,
        has_url=has_url,
        urls=urls,
        force_url_check=force_url_check,
        target_resource_ids=target_resource_ids,
        progress=progress,
        outcome=outcome,
    )
    progress.changed_any = progress.changed_any or fingerprint_changed
    copied = 0
    if can_reuse and progress.active_revision is not None:
        copied = _copy_resource_revision(
            connection,
            notebook_id=notebook_id,
            from_revision=progress.active_revision,
            to_revision=revision,
            resource_id=resource_id,
        )
    if copied:
        progress.available_sources += copied
        return outcome
    progress.changed_any = True
    origins, warnings = llm_wiki_extractors.extract_resource_sources(
        page.metadata or {},
        "",
        vault_path,
        table,
        source_config,
    )
    outcome.url_validators = _url_validators_from_origins(
        urls,
        origins,
        outcome.url_validators or {},
    )
    outcome.url_checked_at = _now() if has_url else None
    _store_extracted_sources(
        connection,
        notebook_id=notebook_id,
        revision=revision,
        resource_id=resource_id,
        origins=origins,
        warnings=warnings,
        progress=progress,
        outcome=outcome,
    )
    return outcome


def _persist_resource(
    connection: sqlite3.Connection,
    *,
    notebook_id: str,
    revision: int,
    resource_id: str,
    index: int,
    outcome: _ResourceOutcome,
    progress: _IngestProgress,
) -> None:
    connection.execute(
        """UPDATE notebook_resources SET fingerprint=?,url_validators_json=?,
        url_checked_at=?,last_checked_at=?,state=?,error=?,updated_at=?
        WHERE notebook_id=? AND resource_id=?""",
        (
            outcome.fingerprint,
            json.dumps(
                outcome.url_validators or {},
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            outcome.url_checked_at,
            _now(),
            outcome.state,
            outcome.error,
            _now(),
            notebook_id,
            resource_id,
        ),
    )
    _update_ingest_counters(connection, notebook_id, revision, index, progress)
    connection.commit()


def _finalize_ingest(
    notebook_id: str,
    revision: int,
    progress: _IngestProgress,
) -> int:
    with _WRITE_LOCK, _connect() as connection:
        completed_at = _now()
        unchanged = (
            progress.available_sources > 0
            and progress.active_revision is not None
            and not progress.changed_any
            and progress.error_sources == 0
        )
        if unchanged:
            connection.execute(
                "DELETE FROM notebook_chunks_fts WHERE notebook_id=? AND revision=?",
                (notebook_id, revision),
            )
            connection.execute(
                "DELETE FROM notebook_sources WHERE notebook_id=? AND revision=?",
                (notebook_id, revision),
            )
            connection.execute(
                """UPDATE notebook_revisions SET state='unchanged',completed_at=?,
                available_sources=0,error_sources=0,current_resource_id=NULL,
                current_resource_title=NULL WHERE notebook_id=? AND revision=?""",
                (completed_at, notebook_id, revision),
            )
            connection.execute(
                """UPDATE notebooks SET status='available',last_error=NULL,
                updated_at=? WHERE id=?""",
                (completed_at, notebook_id),
            )
            revision = cast(int, progress.active_revision)
        elif progress.available_sources > 0:
            connection.execute(
                """UPDATE notebook_revisions SET state='completed',completed_at=?,
                available_sources=?,error_sources=?,current_resource_id=NULL,
                current_resource_title=NULL WHERE notebook_id=? AND revision=?""",
                (
                    completed_at,
                    progress.available_sources,
                    progress.error_sources,
                    notebook_id,
                    revision,
                ),
            )
            connection.execute(
                """UPDATE notebooks SET active_revision=?,status='available',
                last_error=?,updated_at=? WHERE id=?""",
                (
                    revision,
                    f"{progress.error_sources} source errors" if progress.error_sources else None,
                    completed_at,
                    notebook_id,
                ),
            )
        else:
            message = "No notebook source could be indexed."
            connection.execute(
                """UPDATE notebook_revisions SET state='failed',completed_at=?,error=?
                ,current_resource_id=NULL,current_resource_title=NULL
                WHERE notebook_id=? AND revision=?""",
                (completed_at, message, notebook_id, revision),
            )
            connection.execute(
                """UPDATE notebooks SET status=?,last_error=?,updated_at=? WHERE id=?""",
                (
                    "available" if progress.active_revision is not None else "error",
                    message,
                    completed_at,
                    notebook_id,
                ),
            )
        _prune_notebook_revisions(connection, notebook_id)
        connection.commit()
    return revision


def _run_ingest(vault_path: Path, job_id: str, worker_id: str) -> dict[str, Any]:
    notebook_id, revision, force_url_check, target_resource_ids, payload = _ingest_request(job_id)
    notebook = _notebook_row(notebook_id)
    active_revision_value = notebook.get("active_revision")
    active_revision = int(active_revision_value) if active_revision_value is not None else None
    progress = _IngestProgress(
        active_revision=active_revision,
        changed_any=(
            bool(target_resource_ids)
            or active_revision is None
            or str(payload.get("reason") or "") in {"source_removed", "sources_added"}
        ),
    )
    from backend.services.context_vars import active_vault_path

    resolved_vault = Path(vault_path).resolve()
    token = active_vault_path.set(resolved_vault)
    try:
        if durable_job_queue.is_cancelled(job_id):
            raise NotebookIngestionCancelled("Notebook ingestion was cancelled.")
        table, source_config, pages = _current_resource_snapshot(notebook)
        pages_by_id = {str(page.id): page for page in pages}
        _mark_ingest_started(notebook_id, revision)
        with _connect() as connection:
            resources = connection.execute(
                """SELECT * FROM notebook_resources WHERE notebook_id=?
                ORDER BY ordinal,resource_id""",
                (notebook_id,),
            ).fetchall()
        for index, resource in enumerate(resources, start=1):
            if durable_job_queue.is_cancelled(job_id):
                raise NotebookIngestionCancelled("Notebook ingestion was cancelled.")
            resource_id = str(resource["resource_id"])
            page = pages_by_id.get(resource_id)
            resource_title = _bounded_text(
                getattr(page, "title", "") if page is not None else resource_id,
                500,
                resource_id,
            )
            _set_current_resource(notebook_id, revision, resource_id, resource_title)
            with _WRITE_LOCK, _connect() as connection:
                if _copy_unselected_resource(
                    connection,
                    notebook_id=notebook_id,
                    revision=revision,
                    resource_id=resource_id,
                    target_resource_ids=target_resource_ids,
                    index=index,
                    progress=progress,
                ):
                    continue
                outcome = (
                    _missing_resource(
                        connection,
                        notebook_id=notebook_id,
                        revision=revision,
                        resource_id=resource_id,
                        progress=progress,
                    )
                    if page is None
                    else _present_resource(
                        connection,
                        notebook_id=notebook_id,
                        revision=revision,
                        resource=resource,
                        resource_id=resource_id,
                        page=page,
                        table=table,
                        source_config=source_config,
                        vault_path=resolved_vault,
                        force_url_check=force_url_check,
                        target_resource_ids=target_resource_ids,
                        progress=progress,
                    )
                )
                if durable_job_queue.is_cancelled(job_id):
                    raise NotebookIngestionCancelled("Notebook ingestion was cancelled.")
                _persist_resource(
                    connection,
                    notebook_id=notebook_id,
                    revision=revision,
                    resource_id=resource_id,
                    index=index,
                    outcome=outcome,
                    progress=progress,
                )
            if index % 10 == 0:
                durable_job_queue.heartbeat(job_id, worker_id)
        if durable_job_queue.is_cancelled(job_id):
            raise NotebookIngestionCancelled("Notebook ingestion was cancelled.")
        revision = _finalize_ingest(notebook_id, revision, progress)
        return {
            "notebook_id": notebook_id,
            "revision": revision,
            "available_sources": progress.available_sources,
            "error_sources": progress.error_sources,
            "unchanged": bool(
                progress.active_revision is not None
                and not progress.changed_any
                and progress.error_sources == 0
            ),
        }
    finally:
        active_vault_path.reset(token)


def _ingest_thread(vault_path: Path, job_id: str) -> None:
    worker_id = f"notebook:{uuid.uuid4().hex[:12]}"
    try:
        if not durable_job_queue.claim(job_id, worker_id=worker_id, lease_seconds=600):
            return
        result = _run_ingest(vault_path, job_id, worker_id)
        durable_job_queue.complete(job_id, worker_id, result)
    except NotebookIngestionCancelled:
        durable_job_queue.cancel(job_id, reason="Notebook ingestion was cancelled.")
        item = durable_job_queue.get(job_id)
        payload = item.get("payload") if isinstance(item, dict) else {}
        notebook_id = str((payload or {}).get("notebook_id") or "")
        revision = int((payload or {}).get("revision") or 0)
        if notebook_id and revision:
            timestamp = _now()
            with _WRITE_LOCK, _connect() as connection:
                connection.execute(
                    """UPDATE notebook_revisions SET state='cancelled',error=?,
                    completed_at=COALESCE(completed_at,?),
                    cancel_requested_at=COALESCE(cancel_requested_at,?)
                    WHERE notebook_id=? AND revision=?""",
                    (
                        "Indexing was cancelled by the notebook creator.",
                        timestamp,
                        timestamp,
                        notebook_id,
                        revision,
                    ),
                )
                connection.execute(
                    """UPDATE notebooks SET status=CASE WHEN active_revision IS NULL
                    THEN 'error' ELSE 'available' END,last_error=?,updated_at=?
                    WHERE id=?""",
                    (
                        "Indexing was cancelled by the notebook creator.",
                        timestamp,
                        notebook_id,
                    ),
                )
                _prune_notebook_revisions(connection, notebook_id)
                connection.commit()
    except Exception as exc:  # noqa: BLE001
        if durable_job_queue.is_cancelled(job_id):
            return
        log.exception("Notebook ingestion failed for durable job %s", job_id)
        durable_job_queue.fail(job_id, worker_id, exc)
        item = durable_job_queue.get(job_id)
        payload = item.get("payload") if isinstance(item, dict) else {}
        notebook_id = str((payload or {}).get("notebook_id") or "")
        revision = int((payload or {}).get("revision") or 0)
        if notebook_id and revision:
            with _WRITE_LOCK, _connect() as connection:
                connection.execute(
                    """UPDATE notebook_revisions SET state='failed',error=?,completed_at=?
                    WHERE notebook_id=? AND revision=?""",
                    (_bounded_text(exc, 2_000), _now(), notebook_id, revision),
                )
                connection.execute(
                    """UPDATE notebooks SET status=CASE WHEN active_revision IS NULL
                    THEN 'error' ELSE 'available' END,last_error=?,updated_at=? WHERE id=?""",
                    (_bounded_text(exc, 2_000), _now(), notebook_id),
                )
                _prune_notebook_revisions(connection, notebook_id)
                connection.commit()
    finally:
        with _THREAD_LOCK:
            _THREADS.pop(job_id, None)


def launch_ingest(vault_path: Path, job_id: str) -> None:
    """Launch a process-local owner for one durable ingestion lease."""
    with _THREAD_LOCK:
        existing = _THREADS.get(job_id)
        if existing and existing.is_alive():
            return
        thread = threading.Thread(
            target=_ingest_thread,
            args=(Path(vault_path).resolve(), str(job_id)),
            name=f"notebook-ingest-{str(job_id)[:8]}",
            daemon=True,
        )
        _THREADS[job_id] = thread
        thread.start()
