"""Notebook lifecycle and refresh orchestration."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any, Iterable, Optional

from fastapi import HTTPException

from backend.domains.notebooks.catalog import _validate_current_resources
from backend.domains.notebooks.ingestion import launch_ingest
from backend.domains.notebooks.repository import (
    _bounded_text,
    _connect,
    _normalize_resource_ids,
    _notebook_row,
    _now,
    _summary,
    _vault_scope,
    authorize,
    conversation_principal,
    conversation_session_id,
)
from backend.domains.notebooks.resources import (
    _current_resource_snapshot,
    _needs_refresh,
    _prune_notebook_revisions,
)
from backend.domains.notebooks.state import (
    _WRITE_LOCK,
    CONVERSATION_MODES,
    VISIBILITIES,
)
from backend.services import durable_job_queue
from backend.services.workspace_service import ROLE_WEIGHTS, WorkspaceContext


def get_notebook(
    notebook_id: str,
    context: WorkspaceContext,
    *,
    action: str = "read",
    schedule_refresh: bool = False,
) -> dict[str, Any]:
    notebook = authorize(notebook_id, context, action=action)
    if schedule_refresh:
        request_refresh(notebook_id, context, reason="open")
        notebook = authorize(notebook_id, context, action=action)
    with _connect() as connection:
        result = _summary(connection, notebook)
    result["can_manage"] = notebook["owner_user_id"] == context.user_id
    result["can_chat"] = ROLE_WEIGHTS.get(context.role.lower(), 0) >= ROLE_WEIGHTS["editor"]
    result["conversation_principal"] = conversation_principal(notebook, context.user_id)
    result["conversation_session_id"] = conversation_session_id(notebook)
    return result


def list_notebooks(
    context: WorkspaceContext,
    *,
    query: str = "",
    page: int = 1,
    page_size: int = 24,
) -> dict[str, Any]:
    page = max(1, int(page))
    page_size = max(1, min(int(page_size), 100))
    where = ["vault_scope=?", "workspace_id=?", "(visibility='workspace' OR owner_user_id=?)"]
    params: list[Any] = [_vault_scope(context.vault_path), context.workspace_id, context.user_id]
    normalized_query = _bounded_text(query, 200)
    if normalized_query:
        where.append("title LIKE ? ESCAPE '\\'")
        escaped = normalized_query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        params.append(f"%{escaped}%")
    where_sql = " AND ".join(where)
    with _connect() as connection:
        total = int(
            connection.execute(
                f"SELECT COUNT(*) FROM notebooks WHERE {where_sql}", params
            ).fetchone()[0]
        )
        rows = connection.execute(
            f"""SELECT * FROM notebooks WHERE {where_sql}
            ORDER BY updated_at DESC LIMIT ? OFFSET ?""",
            [*params, page_size, (page - 1) * page_size],
        ).fetchall()
        items = [_summary(connection, dict(row)) for row in rows]
    return {"items": items, "page": page, "page_size": page_size, "total": total}


def create_notebook(
    context: WorkspaceContext,
    *,
    title: str,
    visibility: str,
    conversation_mode: str,
    resource_ids: Iterable[Any],
) -> dict[str, Any]:
    table_id, normalized_ids = _validate_current_resources(resource_ids)
    visibility = str(visibility or "private").strip().lower()
    conversation_mode = str(conversation_mode or "private_member").strip().lower()
    if visibility not in VISIBILITIES:
        raise HTTPException(status_code=400, detail="Invalid notebook visibility.")
    if conversation_mode not in CONVERSATION_MODES:
        raise HTTPException(status_code=400, detail="Invalid conversation mode.")
    notebook_id = uuid.uuid4().hex
    timestamp = _now()
    normalized_title = _bounded_text(title, 160, "Untitled notebook")
    with _WRITE_LOCK, _connect() as connection:
        connection.execute(
            """INSERT INTO notebooks
            (id,vault_scope,workspace_id,owner_user_id,source_table_id,title,
             visibility,conversation_mode,status,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (
                notebook_id,
                _vault_scope(context.vault_path),
                context.workspace_id,
                context.user_id,
                table_id,
                normalized_title,
                visibility,
                conversation_mode,
                "pending",
                timestamp,
                timestamp,
            ),
        )
        connection.execute(
            "INSERT INTO notebook_acl VALUES(?,?,?,?)",
            (notebook_id, "user", context.user_id, "owner"),
        )
        if visibility == "workspace":
            connection.execute(
                "INSERT INTO notebook_acl VALUES(?,?,?,?)",
                (notebook_id, "workspace", context.workspace_id, "viewer"),
            )
        connection.executemany(
            """INSERT INTO notebook_resources
            (notebook_id,resource_id,ordinal,state,updated_at) VALUES(?,?,?,?,?)""",
            [
                (notebook_id, resource_id, ordinal, "pending", timestamp)
                for ordinal, resource_id in enumerate(normalized_ids)
            ],
        )
        connection.commit()
    request_refresh(notebook_id, context, reason="create", force=True)
    return get_notebook(notebook_id, context)


def _normalize_groups(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in groups:
        if not isinstance(item, dict):
            continue
        group_id = str(item.get("id") or "").strip() or f"grp_{uuid.uuid4().hex[:8]}"
        group_name = str(item.get("name") or "").strip() or "Unnamed group"
        resource_ids = [
            str(resource_id).strip()
            for resource_id in item.get("resource_ids") or []
            if str(resource_id).strip()
        ]
        normalized.append({"id": group_id, "name": group_name, "resource_ids": resource_ids})
    return normalized


def _notebook_update_fields(
    *,
    title: Optional[str] = None,
    visibility: Optional[str] = None,
    conversation_mode: Optional[str] = None,
    groups: Optional[list[dict[str, Any]]] = None,
) -> tuple[list[str], list[Any]]:
    fields: list[str] = []
    params: list[Any] = []
    if title is not None:
        fields.append("title=?")
        params.append(_bounded_text(title, 160, "Untitled notebook"))
    if visibility is not None:
        normalized_visibility = str(visibility).strip().lower()
        if normalized_visibility not in VISIBILITIES:
            raise HTTPException(status_code=400, detail="Invalid notebook visibility.")
        fields.append("visibility=?")
        params.append(normalized_visibility)
    if conversation_mode is not None:
        normalized_mode = str(conversation_mode).strip().lower()
        if normalized_mode not in CONVERSATION_MODES:
            raise HTTPException(status_code=400, detail="Invalid conversation mode.")
        fields.append("conversation_mode=?")
        params.append(normalized_mode)
    if groups is not None:
        fields.append("groups_json=?")
        params.append(json.dumps(_normalize_groups(groups)))
    return fields, params


def _sync_workspace_acl(
    connection: Any,
    notebook_id: str,
    workspace_id: str,
    visibility: str,
) -> None:
    connection.execute(
        "DELETE FROM notebook_acl WHERE notebook_id=? AND principal_type='workspace'",
        (notebook_id,),
    )
    if visibility == "workspace":
        connection.execute(
            "INSERT INTO notebook_acl VALUES(?,?,?,?)",
            (notebook_id, "workspace", workspace_id, "viewer"),
        )


def update_notebook(
    notebook_id: str,
    context: WorkspaceContext,
    *,
    title: Optional[str] = None,
    visibility: Optional[str] = None,
    conversation_mode: Optional[str] = None,
    groups: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    notebook = authorize(notebook_id, context, action="manage")
    fields, params = _notebook_update_fields(
        title=title,
        visibility=visibility,
        conversation_mode=conversation_mode,
        groups=groups,
    )
    if not fields:
        return get_notebook(notebook_id, context)
    fields.append("updated_at=?")
    params.extend([_now(), notebook_id])
    with _WRITE_LOCK, _connect() as connection:
        connection.execute(f"UPDATE notebooks SET {', '.join(fields)} WHERE id=?", params)
        if visibility is not None:
            _sync_workspace_acl(
                connection,
                notebook_id,
                str(notebook["workspace_id"]),
                str(visibility).strip().lower(),
            )
        connection.commit()
    return get_notebook(notebook_id, context)


def add_resources(
    notebook_id: str,
    context: WorkspaceContext,
    resource_ids: Iterable[Any],
) -> dict[str, Any]:
    authorize(notebook_id, context, action="manage")
    current_table_id, normalized = _validate_current_resources(resource_ids)
    notebook = _notebook_row(notebook_id)
    if notebook["source_table_id"] != current_table_id:
        raise HTTPException(
            status_code=409,
            detail=(
                "This notebook remains linked to an earlier References table "
                "and cannot accept Resources from the current table."
            ),
        )
    timestamp = _now()
    with _WRITE_LOCK, _connect() as connection:
        next_ordinal = int(
            connection.execute(
                "SELECT COALESCE(MAX(ordinal), -1) + 1 FROM notebook_resources WHERE notebook_id=?",
                (notebook_id,),
            ).fetchone()[0]
        )
        for offset, resource_id in enumerate(normalized):
            connection.execute(
                """INSERT OR IGNORE INTO notebook_resources
                (notebook_id,resource_id,ordinal,state,updated_at) VALUES(?,?,?,?,?)""",
                (notebook_id, resource_id, next_ordinal + offset, "pending", timestamp),
            )
        connection.execute("UPDATE notebooks SET updated_at=? WHERE id=?", (timestamp, notebook_id))
        connection.commit()
    request_refresh(notebook_id, context, reason="sources_added", force=True)
    return get_notebook(notebook_id, context)


def remove_resource(
    notebook_id: str,
    context: WorkspaceContext,
    resource_id: str,
) -> dict[str, Any]:
    authorize(notebook_id, context, action="manage")
    with _WRITE_LOCK, _connect() as connection:
        cursor = connection.execute(
            "DELETE FROM notebook_resources WHERE notebook_id=? AND resource_id=?",
            (notebook_id, str(resource_id)),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Resource is not in this notebook.")
        connection.execute("UPDATE notebooks SET updated_at=? WHERE id=?", (_now(), notebook_id))
        connection.commit()
    # Retrieval joins against current membership, so removal is immediate even
    # while the compacted follow-up revision is still queued.
    request_refresh(notebook_id, context, reason="source_removed", force=True)
    return get_notebook(notebook_id, context)


def list_notebook_sources(
    notebook_id: str,
    context: WorkspaceContext,
    *,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    notebook = authorize(notebook_id, context)
    try:
        _table, _source_config, current_pages = _current_resource_snapshot(notebook)
        resource_titles = {str(item.id): str(item.title or item.id) for item in current_pages}
    except Exception:  # noqa: BLE001
        resource_titles = {}
    page = max(1, int(page))
    page_size = max(1, min(int(page_size), 200))
    revision = notebook.get("active_revision")
    with _connect() as connection:
        total = int(
            connection.execute(
                "SELECT COUNT(*) FROM notebook_resources WHERE notebook_id=?",
                (notebook_id,),
            ).fetchone()[0]
        )
        resources = connection.execute(
            """SELECT * FROM notebook_resources WHERE notebook_id=?
            ORDER BY ordinal, resource_id LIMIT ? OFFSET ?""",
            (notebook_id, page_size, (page - 1) * page_size),
        ).fetchall()
        items = []
        for resource in resources:
            sources: list[dict[str, Any]] = []
            if revision is not None:
                sources = [
                    dict(row)
                    for row in connection.execute(
                        """SELECT source_id,resource_id,kind,label,source_url,
                        fingerprint,snapshot_id,status,error
                        FROM notebook_sources
                        WHERE notebook_id=? AND revision=? AND resource_id=?
                        ORDER BY label,source_id""",
                        (notebook_id, int(revision), resource["resource_id"]),
                    ).fetchall()
                ]
            items.append(
                {
                    "resource_id": resource["resource_id"],
                    "title": resource_titles.get(
                        str(resource["resource_id"]), str(resource["resource_id"])
                    ),
                    "state": resource["state"],
                    "error": resource["error"],
                    "updated_at": resource["updated_at"],
                    "last_checked_at": resource["last_checked_at"],
                    "url_checked_at": resource["url_checked_at"],
                    "sources": sources,
                }
            )
    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
        "active_revision": revision,
    }


def list_chat_source_options(
    notebook_id: str,
    context: WorkspaceContext,
) -> dict[str, Any]:
    """Return authorized source and notebook choices for future chat turns."""
    notebook = authorize(notebook_id, context)
    revision = int(notebook.get("active_revision") or 0)
    sources: list[dict[str, Any]] = []
    with _connect() as connection:
        if revision > 0:
            sources = [
                dict(row)
                for row in connection.execute(
                    """SELECT s.source_id,s.resource_id,s.kind,s.label,s.status
                    FROM notebook_sources s
                    JOIN notebook_resources r ON r.notebook_id=s.notebook_id
                      AND r.resource_id=s.resource_id
                    WHERE s.notebook_id=? AND s.revision=?
                      AND s.status IN ('available','stale')
                    ORDER BY s.label COLLATE NOCASE,s.source_id""",
                    (notebook_id, revision),
                ).fetchall()
            ]
        rows = connection.execute(
            """SELECT * FROM notebooks
            WHERE vault_scope=? AND workspace_id=? AND id<>?
              AND (visibility='workspace' OR owner_user_id=?)
              AND active_revision IS NOT NULL
            ORDER BY title COLLATE NOCASE,id""",
            (
                _vault_scope(context.vault_path),
                context.workspace_id,
                notebook_id,
                context.user_id,
            ),
        ).fetchall()
        notebooks = []
        for row in rows:
            summary = _summary(connection, dict(row))
            if summary["chat_ready"]:
                notebooks.append(
                    {
                        "id": summary["id"],
                        "title": summary["title"],
                        "visibility": summary["visibility"],
                        "active_revision": summary["active_revision"],
                        "source_count": summary["source_counts"]["available"],
                    }
                )
    return {
        "notebook_id": notebook_id,
        "active_revision": revision or None,
        "sources": sources,
        "notebooks": notebooks,
    }


def delete_notebook(notebook_id: str, context: WorkspaceContext) -> None:
    authorize(notebook_id, context, action="manage")
    with _WRITE_LOCK, _connect() as connection:
        # FTS5 has no foreign-key relationship, so clear it explicitly before
        # cascading all structured derived data.
        connection.execute("DELETE FROM notebook_chunks_fts WHERE notebook_id=?", (notebook_id,))
        connection.execute("DELETE FROM notebooks WHERE id=?", (notebook_id,))
        connection.commit()


def request_refresh(
    notebook_id: str,
    context: WorkspaceContext,
    *,
    reason: str,
    force: bool = False,
    resource_ids: Optional[Iterable[Any]] = None,
) -> dict[str, Any]:
    target_resource_ids = _normalize_resource_ids(resource_ids) if resource_ids is not None else []
    notebook = authorize(
        notebook_id,
        context,
        action="manage" if target_resource_ids else "read",
    )
    notebook = {**notebook, "vault_path": str(context.vault_path)}
    with _WRITE_LOCK, _connect() as connection:
        if target_resource_ids:
            placeholders = ",".join("?" for _ in target_resource_ids)
            present = {
                str(row[0])
                for row in connection.execute(
                    f"""SELECT resource_id FROM notebook_resources
                    WHERE notebook_id=? AND resource_id IN ({placeholders})""",
                    [notebook_id, *target_resource_ids],
                ).fetchall()
            }
            if present != set(target_resource_ids):
                raise HTTPException(
                    status_code=404,
                    detail="One or more Resources are not in this notebook.",
                )
        running = connection.execute(
            """SELECT * FROM notebook_revisions WHERE notebook_id=?
            AND state IN ('queued','indexing') ORDER BY revision DESC LIMIT 1""",
            (notebook_id,),
        ).fetchone()
        if running:
            return dict(running)
    if not force and not _needs_refresh(notebook):
        return {"state": "current", "revision": notebook.get("active_revision")}
    with _WRITE_LOCK, _connect() as connection:
        next_revision = int(
            connection.execute(
                "SELECT COALESCE(MAX(revision),0)+1 FROM notebook_revisions WHERE notebook_id=?",
                (notebook_id,),
            ).fetchone()[0]
        )
        resource_count = int(
            connection.execute(
                "SELECT COUNT(*) FROM notebook_resources WHERE notebook_id=?",
                (notebook_id,),
            ).fetchone()[0]
        )
        job_id = uuid.uuid4().hex
        timestamp = _now()
        connection.execute(
            """INSERT INTO notebook_revisions
            (notebook_id,revision,job_id,state,total_resources,created_at,
             retention_eligible)
            VALUES(?,?,?,?,?,?,1)""",
            (notebook_id, next_revision, job_id, "queued", resource_count, timestamp),
        )
        connection.execute(
            "UPDATE notebooks SET status='pending',last_error=NULL,updated_at=? WHERE id=?",
            (timestamp, notebook_id),
        )
        connection.commit()
    payload = {
        "job_id": job_id,
        "notebook_id": notebook_id,
        "revision": next_revision,
        "vault_path": str(Path(context.vault_path).resolve()),
        "workspace_id": context.workspace_id,
        "requested_by": context.user_id,
        "reason": _bounded_text(reason, 80, "refresh"),
        "force": bool(force),
        "target_resource_ids": target_resource_ids,
    }
    durable_job_queue.enqueue(
        "notebook_ingest",
        payload,
        idempotency_key=f"notebook-ingest:{notebook_id}:{next_revision}",
        job_id=job_id,
        max_attempts=3,
    )
    launch_ingest(Path(context.vault_path), job_id)
    return {"job_id": job_id, "revision": next_revision, "state": "queued"}


def cancel_refresh(
    notebook_id: str,
    context: WorkspaceContext,
) -> dict[str, Any]:
    """Cancel the active ingestion while retaining the last complete revision."""
    authorize(notebook_id, context, action="manage")
    with _connect() as connection:
        revision = connection.execute(
            """SELECT * FROM notebook_revisions WHERE notebook_id=?
            AND state IN ('queued','indexing') ORDER BY revision DESC LIMIT 1""",
            (str(notebook_id),),
        ).fetchone()
        if revision is None:
            raise HTTPException(status_code=409, detail="No indexing job is active.")
        job_id = str(revision["job_id"] or "")
        revision_number = int(revision["revision"])
    message = "Indexing was cancelled by the notebook creator."
    if not job_id or not durable_job_queue.cancel(job_id, reason=message):
        raise HTTPException(
            status_code=409,
            detail="The indexing job has already finished.",
        )
    with _WRITE_LOCK, _connect() as connection:
        timestamp = _now()
        connection.execute(
            """UPDATE notebook_revisions SET state='cancelled',completed_at=?,
            cancel_requested_at=?,error=? WHERE notebook_id=? AND revision=?""",
            (
                timestamp,
                timestamp,
                message,
                str(notebook_id),
                revision_number,
            ),
        )
        connection.execute(
            """UPDATE notebooks SET status=CASE WHEN active_revision IS NULL
            THEN 'error' ELSE 'available' END,last_error=?,updated_at=? WHERE id=?""",
            (message, timestamp, str(notebook_id)),
        )
        _prune_notebook_revisions(connection, str(notebook_id))
        connection.commit()
    return get_notebook(notebook_id, context)
