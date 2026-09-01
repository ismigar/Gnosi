"""Notebook conversation scope and agent context resolution."""

from __future__ import annotations

from typing import Any, Iterable, Optional

from fastapi import HTTPException

from backend.domains.notebooks.repository import (
    _connect,
    _notebook_row,
    _summary,
    authorize,
    register_conversation_principal,
)
from backend.domains.notebooks.resources import _pin_active_notebook_revision
from backend.domains.notebooks.service import request_refresh
from backend.services.workspace_service import WorkspaceContext


def _authorized_source_ids(
    notebook_id: str,
    revision: int,
    source_ids: Optional[Iterable[str]],
) -> Optional[list[str]]:
    """Validate a bounded source selection against current notebook membership."""
    if source_ids is None:
        return None
    selected = list(
        dict.fromkeys(
            str(source_id).strip()[:128] for source_id in source_ids if str(source_id or "").strip()
        )
    )
    if len(selected) > 1_000:
        raise HTTPException(status_code=400, detail="Too many notebook sources selected.")
    if not selected:
        return []
    placeholders = ",".join("?" for _item in selected)
    with _connect() as connection:
        rows = connection.execute(
            f"""SELECT s.source_id FROM notebook_sources s
            JOIN notebook_resources r ON r.notebook_id=s.notebook_id
              AND r.resource_id=s.resource_id
            WHERE s.notebook_id=? AND s.revision=?
              AND s.status IN ('available','stale')
              AND s.source_id IN ({placeholders})""",
            (notebook_id, int(revision), *selected),
        ).fetchall()
    available = {str(row[0]) for row in rows}
    if available != set(selected):
        raise HTTPException(
            status_code=400,
            detail="One or more selected notebook sources are unavailable.",
        )
    return selected


def resolve_chat_contexts(
    primary_notebook_id: str,
    requested_refs: Iterable[dict[str, Any]],
    context: WorkspaceContext,
    *,
    schedule_refresh: bool = True,
) -> dict[str, Any]:
    """Authorize, validate, and pin every notebook attached to one chat turn."""
    requested = []
    seen: set[str] = set()
    for raw in requested_refs:
        notebook_id = str(raw.get("ref") or "").strip()
        if not notebook_id or notebook_id in seen:
            continue
        seen.add(notebook_id)
        requested.append(raw)
    if not requested or len(requested) > 16:
        raise HTTPException(status_code=400, detail="Select between 1 and 16 notebooks.")
    if primary_notebook_id not in seen:
        raise HTTPException(
            status_code=400,
            detail="The conversation notebook must remain attached to the turn.",
        )

    primary = authorize(primary_notebook_id, context, action="chat")
    scope = register_conversation_principal(primary, context.user_id)
    pin_id = f"{scope['principal_id']}:{scope['session_id']}"
    contexts: list[dict[str, Any]] = []
    total_selected_sources = 0
    for raw in requested:
        notebook_id = str(raw["ref"])
        notebook = authorize(notebook_id, context, action="chat")
        if schedule_refresh:
            request_refresh(notebook_id, context, reason="question")
            notebook = authorize(notebook_id, context, action="chat")
        with _connect() as connection:
            summary = _summary(connection, notebook)
        if not summary["chat_ready"]:
            raise HTTPException(
                status_code=409,
                detail=f"The notebook '{notebook['title']}' has no available sources yet.",
            )
        revision = _pin_active_notebook_revision(
            notebook_id,
            pin_type="conversation",
            pin_id=pin_id,
        )
        raw_scope = raw.get("scope")
        client_scope: dict[str, Any] = dict(raw_scope) if isinstance(raw_scope, dict) else {}
        selection = str(client_scope.get("selection") or "all").lower()
        requested_source_ids = client_scope.get("source_ids") if selection == "sources" else None
        source_ids = _authorized_source_ids(
            notebook_id,
            revision,
            requested_source_ids if isinstance(requested_source_ids, list) else None,
        )
        if source_ids is None:
            total_selected_sources += int(summary["source_counts"]["available"])
        else:
            total_selected_sources += len(source_ids)
        contexts.append(
            {
                "id": f"notebook:{notebook_id}",
                "type": "notebook",
                "ref": notebook_id,
                "label": notebook["title"],
                "scope": {
                    "revision": revision,
                    "selection": "sources" if source_ids is not None else "all",
                    "source_ids": source_ids or [],
                },
            }
        )
    if total_selected_sources <= 0:
        raise HTTPException(status_code=400, detail="Select at least one notebook source.")
    return {
        "notebook_id": primary_notebook_id,
        "revision": contexts[0]["scope"]["revision"] if contexts else None,
        "principal": scope["principal_id"],
        "session_id": scope["session_id"],
        "conversation_mode": primary["conversation_mode"],
        "owner_user_id": primary["owner_user_id"],
        "title": primary["title"],
        "author_user_id": context.user_id,
        "contexts": contexts,
    }


def resolve_chat_context(
    notebook_id: str,
    context: WorkspaceContext,
    *,
    schedule_refresh: bool = True,
) -> dict[str, Any]:
    """Authorize a turn and pin it to one complete notebook revision."""
    result = resolve_chat_contexts(
        notebook_id,
        [{"ref": notebook_id, "scope": {"selection": "all"}}],
        context,
        schedule_refresh=schedule_refresh,
    )
    result["revision"] = result["contexts"][0]["scope"]["revision"]
    return result


def inspect_notebook(
    notebook_id: str,
    revision: Optional[int] = None,
    *,
    source_ids: Optional[Iterable[str]] = None,
) -> dict[str, Any]:
    notebook = _notebook_row(notebook_id)
    resolved_revision = int(
        revision if revision is not None else notebook.get("active_revision") or 0
    )
    if resolved_revision <= 0:
        return {"notebook_id": notebook_id, "revision": None, "resources": [], "sources": []}
    selected_source_ids = _authorized_source_ids(notebook_id, resolved_revision, source_ids)
    source_clause = ""
    source_params: tuple[str, ...] = ()
    if selected_source_ids is not None:
        if not selected_source_ids:
            return {
                "notebook_id": notebook_id,
                "title": notebook["title"],
                "revision": resolved_revision,
                "resource_count": 0,
                "source_count": 0,
                "resources": [],
                "sources": [],
            }
        source_clause = (
            " AND s.source_id IN (" + ",".join("?" for _item in selected_source_ids) + ")"
        )
        source_params = tuple(selected_source_ids)
    with _connect() as connection:
        resources = [
            dict(row)
            for row in connection.execute(
                """SELECT resource_id,state,error,updated_at FROM notebook_resources
                WHERE notebook_id=? ORDER BY ordinal,resource_id""",
                (notebook_id,),
            ).fetchall()
        ]
        sources = [
            dict(row)
            for row in connection.execute(
                f"""SELECT s.source_id,s.resource_id,s.kind,s.label,s.source_url,
                s.status,s.error,COUNT(c.chunk_id) AS chunk_count
                FROM notebook_sources s
                JOIN notebook_resources r ON r.notebook_id=s.notebook_id
                    AND r.resource_id=s.resource_id
                LEFT JOIN notebook_chunks c ON c.notebook_id=s.notebook_id
                    AND c.revision=s.revision AND c.source_id=s.source_id
                WHERE s.notebook_id=? AND s.revision=?
                {source_clause}
                GROUP BY s.source_id ORDER BY s.resource_id,s.label""",
                (notebook_id, resolved_revision, *source_params),
            ).fetchall()
        ]
        selected_resource_ids = {str(source["resource_id"]) for source in sources}
        resources = [
            resource
            for resource in resources
            if str(resource["resource_id"]) in selected_resource_ids
        ]
    return {
        "notebook_id": notebook_id,
        "title": notebook["title"],
        "revision": resolved_revision,
        "resource_count": len(resources),
        "source_count": len(sources),
        "resources": resources,
        "sources": sources,
    }
