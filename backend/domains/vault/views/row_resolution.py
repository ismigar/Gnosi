"""Saved-view filtering, sorting and in-memory joins."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, cast

from backend.domains.vault.views.filters import apply_filter_node, is_filter_group
from backend.domains.vault.views.runtime_types import Metadata, Row, Rows, View
from backend.domains.vault.views.sorting import multi_key_sort


def _metadata(row: Row) -> Metadata:
    value = row.get("metadata") or {}
    return cast(Metadata, value) if isinstance(value, dict) else {}


def _row_field_value(row: Row, field: str) -> object:
    metadata = _metadata(row)
    if field == "id":
        return row.get("id")
    if field == "title":
        return (
            row.get("title")
            or metadata.get("title")
            or metadata.get("Nom")
            or metadata.get("Títol")
            or metadata.get("Name")
            or metadata.get("Título")
        )
    return metadata.get(field)


def _value_keys(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if item not in (None, "")]
    return [str(value)] if value not in (None, "") else []


def row_lookup_by_field(rows: Rows, field: str) -> dict[str, Rows]:
    """Index rows by one metadata, title or identifier field."""
    index: dict[str, Rows] = {}
    for row in rows:
        for key in _value_keys(_row_field_value(row, field)):
            index.setdefault(key, []).append(row)
    return index


def resolve_rows(rows: Rows, view: View, host_page_id: str | None) -> Rows:
    """Filter and sort candidate rows according to one saved view."""
    tree = view.get("filterTree")
    if not is_filter_group(tree):
        raw_filters = view.get("filters")
        filters = raw_filters if isinstance(raw_filters, list) else []
        if not filters and view.get("filter"):
            filters = [view["filter"]]
        tree = {"conjunction": "and", "rules": filters}
    filtered = [row for row in rows if apply_filter_node(_metadata(row), host_page_id, tree)]
    raw_sorts = view.get("sorts")
    sorts = raw_sorts if isinstance(raw_sorts, list) else []
    if not sorts and view.get("sort"):
        sorts = [view["sort"]]
    return multi_key_sort(filtered, sorts)


def resolve_row_ids(rows: Rows, view: View, host_page_id: str | None) -> list[str]:
    return [str(row.get("id")) for row in resolve_rows(rows, view, host_page_id) if row.get("id")]


def _merge_matched(left: Row, right: Row, table_id: str) -> Row:
    merged = dict(left)
    metadata = dict(_metadata(merged))
    right_metadata = _metadata(right)
    for field, value in right_metadata.items():
        metadata.setdefault(field, value)
    metadata[f"_join:{table_id}"] = [right_metadata]
    merged["metadata"] = metadata
    return merged


def _right_join(
    accumulated: Rows,
    right_rows: Rows,
    right_index: dict[str, Rows],
    table_id: str,
    left_field: str,
) -> Rows:
    output: Rows = []
    matched_right_ids: set[str] = set()
    for left in accumulated:
        for key in _value_keys(_row_field_value(left, left_field)):
            for right in right_index.get(key, []):
                matched_right_ids.add(str(right.get("id")))
                output.append(_merge_matched(left, right, table_id))
    for right in right_rows:
        if str(right.get("id")) in matched_right_ids:
            continue
        output.append(
            {
                "id": right.get("id"),
                "title": right.get("title"),
                "metadata": {f"_join:{table_id}": [_metadata(right)]},
            }
        )
    return output


def _left_or_inner_join(
    accumulated: Rows,
    right_index: dict[str, Rows],
    table_id: str,
    left_field: str,
    join_type: str,
) -> Rows:
    output: Rows = []
    for left in accumulated:
        matches = [
            right
            for key in _value_keys(_row_field_value(left, left_field))
            for right in right_index.get(key, [])
        ]
        if not matches and join_type == "left":
            merged = dict(left)
            metadata = dict(_metadata(merged))
            metadata[f"_join:{table_id}"] = []
            merged["metadata"] = metadata
            output.append(merged)
        else:
            output.extend(_merge_matched(left, right, table_id) for right in matches)
    return output


def _join_definition(join: object) -> tuple[str, str, str, str] | None:
    if not isinstance(join, dict):
        return None
    table_id = str(join.get("tableId") or "").strip()
    left_field = str(join.get("leftField") or "").strip()
    right_field = str(join.get("rightField") or "").strip()
    join_type = str(join.get("type") or "inner").strip().lower()
    if not table_id or not left_field or not right_field:
        return None
    if join_type not in ("inner", "left", "right"):
        join_type = "inner"
    return table_id, left_field, right_field, join_type


def _load_right_rows(loader: Callable[[str], Rows], table_id: str) -> Rows:
    try:
        return loader(table_id) or []
    except Exception:
        return []


def apply_joins(
    base_rows: Rows,
    joins: list[dict[str, Any]],
    loader: Callable[[str], Rows],
) -> Rows:
    """Apply ordered inner, left or right joins with deterministic fan-out."""
    if not joins:
        return list(base_rows)
    accumulated = [dict(row) for row in base_rows]
    for raw_join in joins:
        definition = _join_definition(raw_join)
        if definition is None:
            continue
        table_id, left_field, right_field, join_type = definition
        right_rows = _load_right_rows(loader, table_id)
        right_index = row_lookup_by_field(right_rows, right_field)
        if join_type == "right":
            accumulated = _right_join(
                accumulated,
                right_rows,
                right_index,
                table_id,
                left_field,
            )
        else:
            accumulated = _left_or_inner_join(
                accumulated,
                right_index,
                table_id,
                left_field,
                join_type,
            )
    return accumulated


__all__ = [
    "apply_joins",
    "resolve_row_ids",
    "resolve_rows",
    "row_lookup_by_field",
]
