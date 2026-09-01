"""Persistence and authorization primitives for grounded notebooks."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional, cast

from fastapi import HTTPException

from backend.config.app_config import load_params
from backend.domains.notebooks.state import (
    _WRITE_LOCK,
    MAX_RESOURCE_IDS,
    RUNNING_REVISION_STATES,
)
from backend.services.workspace_service import ROLE_WEIGHTS, WorkspaceContext


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _vault_scope(vault_path: Path | str) -> str:
    normalized = str(Path(vault_path).expanduser().resolve())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24]


def database_path() -> Path:
    """Return the local notebook repository shared by runtime modes."""
    local_data = cast(str | Path, load_params(strict_env=False).paths["LOCAL_DATA"])
    root = Path(local_data) / "system"
    root.mkdir(parents=True, exist_ok=True)
    return root / "notebooks.sqlite3"


def _connect() -> sqlite3.Connection:
    path = database_path()
    from backend.migrations.runner import (
        data_dir_for_database,
        ensure_database_schema_once,
    )

    ensure_database_schema_once(path, "notebooks", data_dir_for_database(path))
    connection = sqlite3.connect(path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA busy_timeout=30000")
    return connection


def _row_dict(row: Optional[sqlite3.Row]) -> Optional[dict[str, Any]]:
    return dict(row) if row is not None else None


def _bounded_text(value: Any, limit: int, fallback: str = "") -> str:
    normalized = " ".join(str(value or "").split()).strip()
    return (normalized or fallback)[:limit]


def _normalize_resource_ids(values: Iterable[Any]) -> list[str]:
    normalized = list(
        dict.fromkeys(str(value or "").strip() for value in values if str(value or "").strip())
    )
    if not normalized:
        raise HTTPException(status_code=400, detail="Select at least one Resource.")
    if len(normalized) > MAX_RESOURCE_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"A notebook accepts at most {MAX_RESOURCE_IDS} Resources at once.",
        )
    return normalized


def _notebook_row(notebook_id: str) -> dict[str, Any]:
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM notebooks WHERE id=?", (str(notebook_id),)
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Notebook not found.")
    return dict(row)


def authorize(
    notebook_id: str,
    context: WorkspaceContext,
    *,
    action: str = "read",
) -> dict[str, Any]:
    """Resolve one notebook and enforce its Vault, workspace, and role ACL."""
    notebook = _notebook_row(notebook_id)
    same_scope = notebook["vault_scope"] == _vault_scope(context.vault_path)
    same_workspace = notebook["workspace_id"] == context.workspace_id
    is_owner = notebook["owner_user_id"] == context.user_id
    if not same_scope or not same_workspace:
        raise HTTPException(status_code=404, detail="Notebook not found.")
    if notebook["visibility"] == "private" and not is_owner:
        raise HTTPException(status_code=404, detail="Notebook not found.")
    if action == "chat" and ROLE_WEIGHTS.get(context.role.lower(), 0) < ROLE_WEIGHTS["editor"]:
        raise HTTPException(status_code=403, detail="An editor role is required to converse.")
    if action == "manage" and not is_owner:
        raise HTTPException(status_code=403, detail="Only the notebook creator can manage it.")
    return notebook


def conversation_principal(notebook: dict[str, Any], user_id: str) -> str:
    """Return the isolated checkpoint principal for the active conversation mode."""
    notebook_id = str(notebook["id"])
    if notebook["conversation_mode"] == "shared":
        return f"notebook:{notebook_id}:shared"
    return f"notebook:{notebook_id}:member:{user_id}"


def conversation_session_id(notebook: dict[str, Any]) -> str:
    mode = "shared" if notebook["conversation_mode"] == "shared" else "private"
    return f"notebook-{notebook['id']}-{mode}"


def register_conversation_principal(notebook: dict[str, Any], user_id: str) -> dict[str, str]:
    """Record one derived checkpoint namespace so notebook deletion can purge it."""
    scope = {
        "principal_id": conversation_principal(notebook, user_id),
        "session_id": conversation_session_id(notebook),
        "user_id": str(user_id),
        "conversation_mode": str(notebook["conversation_mode"]),
    }
    with _WRITE_LOCK, _connect() as connection:
        connection.execute(
            """INSERT OR IGNORE INTO notebook_conversation_principals
            (notebook_id,principal_id,session_id,user_id,conversation_mode,created_at)
            VALUES(?,?,?,?,?,?)""",
            (
                str(notebook["id"]),
                scope["principal_id"],
                scope["session_id"],
                scope["user_id"],
                scope["conversation_mode"],
                _now(),
            ),
        )
        connection.commit()
    return scope


def conversation_scopes(notebook_id: str, context: WorkspaceContext) -> list[dict[str, str]]:
    """Return every checkpoint namespace derived from a managed notebook."""
    authorize(notebook_id, context, action="manage")
    with _connect() as connection:
        return [
            dict(row)
            for row in connection.execute(
                """SELECT principal_id,session_id,user_id,conversation_mode
                FROM notebook_conversation_principals WHERE notebook_id=?""",
                (str(notebook_id),),
            ).fetchall()
        ]


def _summary(connection: sqlite3.Connection, notebook: dict[str, Any]) -> dict[str, Any]:
    notebook_id = str(notebook["id"])
    resource_count = int(
        connection.execute(
            "SELECT COUNT(*) FROM notebook_resources WHERE notebook_id=?",
            (notebook_id,),
        ).fetchone()[0]
    )
    active_revision = notebook.get("active_revision")
    source_counts = {"total": 0, "available": 0, "stale": 0, "error": 0}
    if active_revision is not None:
        rows = connection.execute(
            """SELECT status, COUNT(*) AS count FROM notebook_sources
            WHERE notebook_id=? AND revision=? GROUP BY status""",
            (notebook_id, int(active_revision)),
        ).fetchall()
        for row in rows:
            status = str(row["status"])
            count = int(row["count"])
            source_counts["total"] += count
            if status in {"available", "stale"}:
                source_counts["available"] += count
            if status in {"stale", "error"}:
                source_counts[status] += count
    latest_revision = connection.execute(
        """SELECT * FROM notebook_revisions WHERE notebook_id=?
        ORDER BY revision DESC LIMIT 1""",
        (notebook_id,),
    ).fetchone()
    progress = None
    if latest_revision:
        total = int(latest_revision["total_resources"] or 0)
        processed = int(latest_revision["processed_resources"] or 0)
        progress = {
            "revision": int(latest_revision["revision"]),
            "state": latest_revision["state"],
            "processed": processed,
            "total": total,
            "percent": round((processed / total) * 100) if total else 0,
            "job_id": latest_revision["job_id"],
            "error": latest_revision["error"],
            "current_resource_id": latest_revision["current_resource_id"],
            "current_resource_title": latest_revision["current_resource_title"],
            "cancel_requested_at": latest_revision["cancel_requested_at"],
            "cancellable": latest_revision["state"] in RUNNING_REVISION_STATES,
        }
    groups = []
    raw_groups = notebook.get("groups_json")
    if raw_groups:
        try:
            parsed = json.loads(raw_groups)
            if isinstance(parsed, list):
                groups = parsed
        except Exception:
            groups = []
    return {
        **notebook,
        "groups": groups,
        "resource_count": resource_count,
        "source_counts": source_counts,
        "progress": progress,
        "chat_ready": bool(active_revision is not None and source_counts["available"] > 0),
    }
