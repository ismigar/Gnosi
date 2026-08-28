"""Confirmed handlers for table, history, trash and schema operations."""

from __future__ import annotations

import asyncio
from typing import Any

from backend.domains.agent.gnosi_dispatch_basic import ActionHandler
from backend.domains.agent.gnosi_support import (
    _BULK_UPDATE_LOCK,
    ActionConflictError,
    _file_revision,
    _parse,
    _require_file_revision,
    _resolve_page,
    _resolve_snapshotted_row_path,
    _rollback_page_items,
    _table,
    _table_delete_snapshot,
    _trash_snapshot,
    _value_revision,
    _vault,
    _write_page,
)


def _prepare_table_rows(snapshot: dict[str, Any], table_id: str) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    for row in snapshot["rows"]:
        path = _resolve_snapshotted_row_path(row["relative_path"])
        _require_file_revision(path, row["revision"], f"Table row {row['id']}")
        metadata, body = _parse(path)
        current_table_id = str(metadata.get("table_id") or metadata.get("database_table_id") or "")
        if current_table_id != table_id:
            raise ActionConflictError(
                f"Table row {row['id']} changed membership after the preview."
            )
        prepared.append(
            {
                "id": row["id"],
                "path": path,
                "original": path.read_bytes(),
                "metadata": metadata,
                "body": body,
            }
        )
    return prepared


def _unlink_table_rows(
    prepared: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    changed: list[dict[str, Any]] = []
    try:
        with _BULK_UPDATE_LOCK:
            for item in prepared:
                new_metadata = dict(item["metadata"])
                new_metadata.pop("table_id", None)
                new_metadata.pop("database_table_id", None)
                changed.append(item)
                _write_page(item["path"], new_metadata, item["body"])
    except Exception as error:
        rollback_failed = _rollback_page_items(changed)
        if rollback_failed:
            return changed, {
                "status": "partial",
                "updated_count": len(rollback_failed),
                "rollback_failed_ids": rollback_failed,
                "error": str(error)[:500],
            }
        raise RuntimeError("Table row unlinking failed and all rows were rolled back.") from error
    return changed, None


async def _trash_table_rows(
    prepared: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    from backend.api.vault_routes import _move_page_to_trash

    changed: list[dict[str, Any]] = []
    failed_ids: list[str] = []
    for item in prepared:
        try:
            await asyncio.to_thread(_move_page_to_trash, str(item["id"]), item["path"])
            changed.append(item)
        except Exception:
            failed_ids.append(str(item["id"]))
            break
    if not failed_ids:
        return changed, None
    return changed, {
        "status": "partial",
        "updated_count": len(changed),
        "failed_count": len(failed_ids),
        "failed_ids": failed_ids,
        "row_ids": [str(item["id"]) for item in changed],
    }


def _table_delete_conflict_result(
    error: Exception,
    row_action: str,
    changed: list[dict[str, Any]],
) -> dict[str, Any] | None:
    from fastapi import HTTPException

    if row_action == "unlink":
        rollback_failed = _rollback_page_items(changed)
        if rollback_failed:
            detail = error.detail if isinstance(error, HTTPException) else error
            return {
                "status": "partial",
                "updated_count": len(rollback_failed),
                "rollback_failed_ids": rollback_failed,
                "error": str(detail)[:500],
            }
        return None
    if isinstance(error, HTTPException) and error.status_code == 409:
        return {
            "status": "partial",
            "updated_count": len(changed),
            "failed_count": 1,
            "failed_ids": [],
            "row_ids": [str(item["id"]) for item in changed],
        }
    return None


async def _delete_table(
    arguments: dict[str, Any], workspace_id: str, background_tasks: Any
) -> dict[str, Any]:
    del workspace_id
    from fastapi import BackgroundTasks

    from backend.api.vault_routes import delete_table as route_delete_table

    table_id = str(arguments["table_id"])
    table = _table(table_id)
    if not table:
        raise LookupError("Table not found.")
    snapshot = _table_delete_snapshot(table)
    revision_fields = ("table_revision", "views_revision", "rows_revision", "asset_revision")
    if any(str(snapshot[field]) != str(arguments.get(field) or "") for field in revision_fields):
        raise ActionConflictError(
            "The table, its views, rows, or assets changed after the preview."
        )
    row_action = str(arguments.get("row_action") or "").strip().lower()
    if row_action not in {"unlink", "delete"}:
        raise ValueError("The confirmed table row action is invalid.")
    prepared = _prepare_table_rows(snapshot, table_id)
    if row_action == "unlink":
        changed, partial = _unlink_table_rows(prepared)
    else:
        changed, partial = await _trash_table_rows(prepared)
    if partial is not None:
        return partial

    tasks = background_tasks or BackgroundTasks()
    try:
        result = await route_delete_table(
            table_id,
            tasks,
            expected_table_revision=str(arguments["table_revision"]),
            expected_views_revision=str(arguments["views_revision"]),
            expected_asset_revision=str(arguments["asset_revision"]),
        )
    except Exception as error:
        partial = _table_delete_conflict_result(error, row_action, changed)
        if partial is not None:
            if partial.get("failed_ids") == []:
                partial["failed_ids"] = [table_id]
            return partial
        raise
    payload = dict(result) if isinstance(result, dict) else {}
    payload.update(
        {
            "updated_count": len(changed),
            "row_ids": [str(item["id"]) for item in changed],
            "cleanup_status": (
                (result or {}).get("cleanup_status")
                if isinstance(result, dict)
                else ("queued" if tasks.tasks else "not_required")
            ),
        }
    )
    return payload


async def _restore_page_version(
    arguments: dict[str, Any], workspace_id: str, background_tasks: Any
) -> dict[str, Any]:
    del workspace_id
    from fastapi import BackgroundTasks

    from backend.api.vault_routes import restore_page_version as route_restore_page_version

    page_id = str(arguments["page_id"])
    timestamp = str(arguments["timestamp"])
    path = _resolve_page(page_id)
    if not path:
        raise LookupError("Current page not found.")
    version = _vault() / ".history" / page_id / f"{timestamp}.md"
    _require_file_revision(path, str(arguments.get("current_revision") or ""), "The current page")
    _require_file_revision(
        version, str(arguments.get("version_revision") or ""), "The saved version"
    )
    tasks = background_tasks or BackgroundTasks()
    result = await route_restore_page_version(page_id, timestamp, tasks)
    payload = dict(result) if isinstance(result, dict) else {}
    payload["cleanup_status"] = "queued" if tasks.tasks else "not_required"
    return payload


async def _empty_trash(
    arguments: dict[str, Any], workspace_id: str, background_tasks: Any
) -> dict[str, Any]:
    del workspace_id, background_tasks
    from backend.api.vault_routes import _purge_trash_entry

    expected_entries = list(arguments.get("entries") or [])
    if _value_revision(expected_entries) != str(arguments.get("snapshot_digest") or ""):
        raise ActionConflictError("The trash snapshot is invalid.")
    current = {item["id"]: item for item in _trash_snapshot()}
    purged = 0
    failed_ids: list[str] = []
    freed = 0
    for expected in expected_entries:
        entry_id = str(expected.get("id") or "")
        actual = current.get(entry_id)
        if not actual or str(actual.get("revision") or "") != str(expected.get("revision") or ""):
            failed_ids.append(entry_id)
            continue
        try:
            result = await asyncio.to_thread(_purge_trash_entry, entry_id)
            purged += 1
            freed += int(result.get("freed_bytes") or 0)
        except Exception:
            failed_ids.append(entry_id)
    return {
        "status": "partial" if failed_ids else "completed",
        "purged_count": purged,
        "failed_count": len(failed_ids),
        "failed_ids": failed_ids,
        "freed_bytes": freed,
    }


async def _change_schema(
    arguments: dict[str, Any], workspace_id: str, background_tasks: Any
) -> dict[str, Any]:
    del workspace_id, background_tasks
    from backend.api.vault_routes import save_schema

    schema_path = (_vault() / str(arguments["folder"]) / "schema.json").resolve()
    current_revision = _file_revision(schema_path) if schema_path.exists() else ""
    if current_revision != str(arguments.get("current_revision") or ""):
        raise ActionConflictError("The schema changed after the confirmation preview.")
    result = await save_schema(
        str(arguments["folder"]), dict(arguments.get("schema_definition") or {})
    )
    return dict(result)


TABLE_HANDLERS: dict[str, ActionHandler] = {
    "delete_table": _delete_table,
    "restore_page_version": _restore_page_version,
    "empty_trash": _empty_trash,
    "change_schema": _change_schema,
}
