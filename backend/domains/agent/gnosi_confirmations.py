"""Preparation tools for consequential first-party actions."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Dict, List, TypeVar, cast

from backend.domains.agent.gnosi_support import (
    MAX_CONFIRMATION_SAMPLE_ITEMS,
    MAX_DETERMINISTIC_BULK_ITEMS,
    MAX_LIST_ITEMS,
    MAX_REFERENCE_TABLES,
    _confirmation,
    _file_revision,
    _json,
    _parse,
    _reference_title_replacement_plan,
    _resolve_page,
    _table,
    _table_delete_snapshot,
    _table_rows_snapshot,
    _trash_snapshot,
    _value_revision,
    _vault,
)
from backend.utils.safe_io import sanitize_rel_folder

_F = TypeVar("_F", bound=Callable[..., Any])
_runtime_tool: Any
try:
    from langchain_core.tools import tool as imported_tool

    _runtime_tool = imported_tool
except Exception:  # pragma: no cover
    _runtime_tool = None


def _typed_tool(function: _F) -> _F:
    return function if _runtime_tool is None else cast(_F, _runtime_tool(function))


@_typed_tool
def delete_table(table_id_or_name: str, row_action: str = "") -> str:
    """Prepares deleting a table after choosing `unlink` or `delete` for rows."""
    table = _table(table_id_or_name)
    if not table:
        return _json({"error": "Table not found."})
    normalized_row_action = str(row_action or "").strip().lower()
    if normalized_row_action not in {"unlink", "delete"}:
        return _json(
            {
                "error": (
                    "Choose row_action='unlink' to keep the pages without the table "
                    "or row_action='delete' to move every row page to trash."
                )
            }
        )
    table_id = str(table.get("id") or "")
    snapshot = _table_delete_snapshot(table)
    return _confirmation(
        "delete_table",
        {
            "table_id": table_id,
            "table_revision": snapshot["table_revision"],
            "views_revision": snapshot["views_revision"],
            "rows_revision": snapshot["rows_revision"],
            "asset_revision": snapshot["asset_revision"],
            "row_action": normalized_row_action,
        },
        {
            "table": str(table.get("name") or table_id),
            "table_id": table_id,
            "folder": str(table.get("folder") or ""),
            "row_action": normalized_row_action,
            "row_count": snapshot["row_count"],
            "views_count": snapshot["views_count"],
            "table_revision": snapshot["table_revision"],
            "views_revision": snapshot["views_revision"],
            "rows_revision": snapshot["rows_revision"],
            "asset_revision": snapshot["asset_revision"],
        },
    )


@_typed_tool
def restore_page_version(page_id_or_title: str, timestamp: str) -> str:
    """Prepares restoring a page version and waits for confirmation."""
    from backend.api import vault_routes

    validate_history_timestamp = cast(
        Callable[[str], str],
        getattr(vault_routes, "_validate_history_timestamp"),
    )
    validate_safe_page_id = cast(
        Callable[[str], str],
        getattr(vault_routes, "_validate_safe_page_id"),
    )

    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})
    metadata, _body = _parse(path)
    page_id = validate_safe_page_id(str(metadata.get("id") or ""))
    safe_timestamp = validate_history_timestamp(timestamp)
    version = _vault() / ".history" / page_id / f"{safe_timestamp}.md"
    if not version.exists():
        return _json({"error": "Page version not found."})
    return _confirmation(
        "restore_page_version",
        {
            "page_id": page_id,
            "timestamp": safe_timestamp,
            "current_revision": _file_revision(path),
            "version_revision": _file_revision(version),
        },
        {
            "page": str(metadata.get("title") or path.stem),
            "page_id": page_id,
            "timestamp": safe_timestamp,
            "current_revision": _file_revision(path),
            "version_revision": _file_revision(version),
        },
    )


@_typed_tool
def empty_trash() -> str:
    """Prepares permanently emptying Vault trash and waits for confirmation."""
    snapshot = _trash_snapshot()
    snapshot_digest = _value_revision(snapshot)
    return _confirmation(
        "empty_trash",
        {
            "entries": snapshot,
            "snapshot_digest": snapshot_digest,
        },
        {
            "count": len(snapshot),
            "entries": [{"id": item["id"], "title": item["title"]} for item in snapshot[:50]],
            "entries_truncated": len(snapshot) > 50,
            "snapshot_digest": snapshot_digest,
        },
    )


@_typed_tool
def change_schema(folder: str, schema_definition: Dict[str, Any]) -> str:
    """Prepares replacing a folder schema and waits for confirmation."""
    safe_folder = sanitize_rel_folder(folder, fallback="")
    if not safe_folder:
        return _json({"error": "A valid schema folder is required."})
    schema_path = (_vault() / safe_folder / "schema.json").resolve()
    vault = _vault()
    if schema_path != vault and vault not in schema_path.parents:
        return _json({"error": "The schema folder is outside the active Vault."})
    current_revision = _file_revision(schema_path) if schema_path.exists() else ""
    properties = schema_definition.get("properties") or []
    return _confirmation(
        "change_schema",
        {
            "folder": safe_folder,
            "schema_definition": schema_definition,
            "current_revision": current_revision,
        },
        {
            "folder": safe_folder,
            "property_count": len(properties),
            "properties": [
                str(item.get("name") or item.get("id") or "")
                for item in properties
                if isinstance(item, dict)
            ][:100],
            "schema_sha256": _value_revision(schema_definition),
        },
    )


@_typed_tool
def bulk_update_rows(updates: List[Dict[str, Any]]) -> str:
    """Prepares up to 100 row updates and waits for confirmation."""
    if not updates or len(updates) > MAX_LIST_ITEMS:
        return _json({"error": f"Between 1 and {MAX_LIST_ITEMS} row updates are required."})
    normalized = []
    for update in updates:
        identifier = str(update.get("id") or update.get("title") or "").strip()
        properties = update.get("properties")
        if not identifier or not isinstance(properties, dict):
            return _json({"error": "Each row update requires an id and properties."})
        path = _resolve_page(identifier)
        if not path:
            return _json({"error": f"Row not found: {identifier}"})
        metadata, _body = _parse(path)
        if not (metadata.get("table_id") or metadata.get("database_table_id")):
            return _json({"error": f"The page is not a table row: {identifier}"})
        normalized.append(
            {
                "id": str(metadata.get("id") or identifier),
                "title": str(metadata.get("title") or path.stem),
                "properties": properties,
                "revision": _file_revision(path),
            }
        )
    return _confirmation(
        "bulk_update_rows",
        {"updates": normalized},
        {
            "count": len(normalized),
            "updates": [
                {
                    "id": item["id"],
                    "title": item["title"],
                    "properties": item["properties"],
                }
                for item in normalized
            ],
        },
    )


@_typed_tool
def replace_reference_ids_in_titles(
    source_table_id_or_name: str,
    reference_tables: Dict[str, str],
) -> str:
    """Prepares a confirmed all-row replacement of reference ids in index titles.

    ``reference_tables`` maps the singular label used in the title to the table
    that owns the referenced rows, for example
    ``{"Projecte": "Projectes", "Àrea": "Àrees"}``. Gnosi reads every row on
    the server; the model must not enumerate candidates or updates.
    """
    source_table = _table(source_table_id_or_name)
    if not source_table:
        return _json({"error": "Source table not found."})
    if not isinstance(reference_tables, dict) or not (
        1 <= len(reference_tables) <= MAX_REFERENCE_TABLES
    ):
        return _json(
            {"error": (f"Between 1 and {MAX_REFERENCE_TABLES} reference tables are required.")}
        )

    source_table_id = str(source_table.get("id") or "")
    source_rows = _table_rows_snapshot(source_table_id)
    if len(source_rows) > MAX_DETERMINISTIC_BULK_ITEMS:
        return _json(
            {"error": ("The source table exceeds the deterministic bulk-edit safety limit.")}
        )

    references: List[Dict[str, Any]] = []
    seen_labels = set()
    for raw_label, table_identifier in reference_tables.items():
        label = str(raw_label or "").strip()
        normalized_label = label.casefold()
        if not label or normalized_label in seen_labels:
            return _json({"error": "Reference labels must be unique and non-empty."})
        seen_labels.add(normalized_label)
        table = _table(str(table_identifier or ""))
        if not table:
            return _json({"error": f"Reference table not found: {table_identifier}"})
        table_id = str(table.get("id") or "")
        rows = _table_rows_snapshot(table_id)
        if len(rows) > MAX_DETERMINISTIC_BULK_ITEMS:
            return _json(
                {
                    "error": (
                        f"Reference table {table.get('name') or table_id} exceeds "
                        "the deterministic bulk-edit safety limit."
                    )
                }
            )
        references.append(
            {
                "label": label,
                "table_id": table_id,
                "table_name": str(table.get("name") or table_id),
                "rows": rows,
                "rows_revision": _value_revision(rows),
            }
        )

    references.sort(key=lambda item: item["label"].casefold())
    updates, unresolved = _reference_title_replacement_plan(
        source_rows,
        references,
    )
    if not updates:
        return _json(
            {
                "error": "No replaceable reference ids were found.",
                "unresolved_count": len(unresolved),
                "unresolved": [
                    {
                        "id": item["id"],
                        "title": item["title"][:240],
                        "label": item["label"][:100],
                        "reference_id": item["reference_id"][:200],
                    }
                    for item in unresolved[:MAX_CONFIRMATION_SAMPLE_ITEMS]
                ],
            }
        )

    compact_references = [
        {
            "label": item["label"],
            "table_id": item["table_id"],
            "rows_revision": item["rows_revision"],
        }
        for item in references
    ]
    return _confirmation(
        "replace_reference_ids_in_titles",
        {
            "source_table_id": source_table_id,
            "source_rows_revision": _value_revision(source_rows),
            "references": compact_references,
            "plan_revision": _value_revision(updates),
            "planned_count": len(updates),
        },
        {
            "count": len(updates),
            "source_table": str(source_table.get("name") or source_table_id),
            "references": [
                {"label": item["label"], "table": item["table_name"]} for item in references
            ],
            "updates": [
                {
                    "id": item["id"],
                    "from": item["old_title"][:240],
                    "to": item["new_title"][:240],
                }
                for item in updates[:MAX_CONFIRMATION_SAMPLE_ITEMS]
            ],
            "updates_truncated": len(updates) > MAX_CONFIRMATION_SAMPLE_ITEMS,
            "unresolved_count": len(unresolved),
            "unresolved": [
                {
                    "id": item["id"],
                    "title": item["title"][:240],
                    "label": item["label"][:100],
                    "reference_id": item["reference_id"][:200],
                }
                for item in unresolved[:MAX_CONFIRMATION_SAMPLE_ITEMS]
            ],
        },
    )
