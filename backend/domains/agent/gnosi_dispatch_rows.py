"""Confirmed handlers for deterministic row rewrites."""

from __future__ import annotations

from typing import Any

from backend.domains.agent.gnosi_dispatch_basic import ActionHandler
from backend.domains.agent.gnosi_support import (
    _BULK_UPDATE_LOCK,
    MAX_DETERMINISTIC_BULK_ITEMS,
    MAX_LIST_ITEMS,
    MAX_REFERENCE_TABLES,
    ActionConflictError,
    _parse,
    _reference_title_replacement_plan,
    _require_file_revision,
    _resolve_page,
    _resolve_snapshotted_row_path,
    _rollback_page_items,
    _table,
    _table_rows_snapshot,
    _value_revision,
    _write_page,
)


def _load_reference_rows(arguments: dict[str, Any]) -> list[dict[str, Any]]:
    references: list[dict[str, Any]] = []
    stored_references = list(arguments.get("references") or [])
    if not (1 <= len(stored_references) <= MAX_REFERENCE_TABLES):
        raise ValueError("The reference table set is invalid.")
    for stored in stored_references:
        table_id = str(stored.get("table_id") or "")
        if not _table(table_id):
            raise LookupError(f"Reference table not found: {table_id}")
        rows = _table_rows_snapshot(table_id)
        if _value_revision(rows) != str(stored.get("rows_revision") or ""):
            raise ActionConflictError("A reference table changed after the confirmation preview.")
        references.append(
            {
                "label": str(stored.get("label") or ""),
                "table_id": table_id,
                "rows": rows,
            }
        )
    return references


def _validated_title_updates(
    arguments: dict[str, Any], source_rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    updates, _unresolved = _reference_title_replacement_plan(
        source_rows, _load_reference_rows(arguments)
    )
    valid = (
        bool(updates)
        and len(updates) <= MAX_DETERMINISTIC_BULK_ITEMS
        and len(updates) == int(arguments.get("planned_count") or 0)
        and _value_revision(updates) == str(arguments.get("plan_revision") or "")
    )
    if not valid:
        raise ActionConflictError(
            "The title replacement plan changed after the confirmation preview."
        )
    return updates


def _prepare_title_updates(
    source_table_id: str, updates: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    for update in updates:
        row_id = str(update["id"])
        path = _resolve_snapshotted_row_path(update["relative_path"])
        _require_file_revision(path, str(update.get("revision") or ""), f"Row {row_id}")
        metadata, body = _parse(path)
        if str(metadata.get("id") or "") != row_id:
            raise ActionConflictError(f"Row {row_id} changed after the confirmation preview.")
        current_table = str(metadata.get("table_id") or metadata.get("database_table_id") or "")
        if current_table != source_table_id:
            raise ActionConflictError(f"Row {row_id} moved after the confirmation preview.")
        if str(metadata.get("title") or path.stem) != update["old_title"]:
            raise ActionConflictError(f"Row {row_id} changed after the confirmation preview.")
        new_metadata = dict(metadata)
        new_metadata["title"] = update["new_title"]
        prepared.append(
            {
                "id": row_id,
                "path": path,
                "original": path.read_bytes(),
                "metadata": new_metadata,
                "body": body,
            }
        )
    return prepared


def _write_transaction(
    prepared: list[dict[str, Any]], failure_message: str
) -> dict[str, Any] | None:
    attempted: list[dict[str, Any]] = []
    try:
        for item in prepared:
            attempted.append(item)
            _write_page(item["path"], item["metadata"], item["body"])
    except Exception as error:
        rollback_failed = _rollback_page_items(attempted)
        if rollback_failed:
            return {
                "status": "partial",
                "updated_count": len(rollback_failed),
                "rollback_failed_ids": rollback_failed,
                "error": str(error)[:500],
            }
        raise RuntimeError(failure_message) from error
    return None


async def _replace_reference_ids_in_titles(
    arguments: dict[str, Any], workspace_id: str, background_tasks: Any
) -> dict[str, Any]:
    del workspace_id, background_tasks
    source_table_id = str(arguments.get("source_table_id") or "")
    if not _table(source_table_id):
        raise LookupError("Source table not found.")
    source_rows = _table_rows_snapshot(source_table_id)
    if _value_revision(source_rows) != str(arguments.get("source_rows_revision") or ""):
        raise ActionConflictError("The source table changed after the confirmation preview.")
    updates = _validated_title_updates(arguments, source_rows)
    with _BULK_UPDATE_LOCK:
        prepared = _prepare_title_updates(source_table_id, updates)
        partial = _write_transaction(
            prepared,
            "The title replacement failed and all changed rows were rolled back.",
        )
    if partial is not None:
        return partial
    return {
        "status": "completed",
        "updated_count": len(prepared),
        "row_ids": [item["id"] for item in prepared[:MAX_LIST_ITEMS]],
        "truncated": len(prepared) > MAX_LIST_ITEMS,
    }


def _prepare_bulk_updates(updates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for update in updates:
        row_id = str(update["id"])
        if row_id in seen_ids:
            raise ValueError(f"Duplicate row update: {row_id}")
        seen_ids.add(row_id)
        path = _resolve_page(row_id)
        if not path:
            raise LookupError(f"Row not found: {row_id}")
        _require_file_revision(path, str(update.get("revision") or ""), f"Row {row_id}")
        metadata, body = _parse(path)
        if not (metadata.get("table_id") or metadata.get("database_table_id")):
            raise ValueError(f"The page is not a table row: {row_id}")
        new_metadata = dict(metadata)
        for key, value in dict(update.get("properties") or {}).items():
            if key not in {"id", "table_id", "database_table_id"}:
                new_metadata[key] = value
        prepared.append(
            {
                "id": row_id,
                "path": path,
                "original": path.read_bytes(),
                "metadata": new_metadata,
                "body": body,
            }
        )
    return prepared


async def _bulk_update_rows(
    arguments: dict[str, Any], workspace_id: str, background_tasks: Any
) -> dict[str, Any]:
    del workspace_id, background_tasks
    updates = list(arguments.get("updates") or [])
    if not updates or len(updates) > MAX_LIST_ITEMS:
        raise ValueError("The bulk update size is invalid.")
    with _BULK_UPDATE_LOCK:
        prepared = _prepare_bulk_updates(updates)
        partial = _write_transaction(
            prepared,
            "The bulk update failed and all changed rows were rolled back.",
        )
    if partial is not None:
        return partial
    return {
        "status": "completed",
        "updated_count": len(prepared),
        "row_ids": [item["id"] for item in prepared],
    }


ROW_HANDLERS: dict[str, ActionHandler] = {
    "replace_reference_ids_in_titles": _replace_reference_ids_in_titles,
    "bulk_update_rows": _bulk_update_rows,
}
