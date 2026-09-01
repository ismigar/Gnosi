"""Frontend-compatible saved-view row sorting."""

from __future__ import annotations

import re
import unicodedata
from functools import cmp_to_key

from backend.domains.vault.views.filters import FULL_NUMERIC_RE, parse_numeric_value
from backend.domains.vault.views.runtime_types import Row, Rows, Sorts

SORTKEY_LEAD_RE = re.compile(r"^[\W_]+", re.UNICODE)


def sort_key(value: object) -> str:
    return SORTKEY_LEAD_RE.sub("", str("" if value is None else value))


def collation_key(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    stripped = "".join(
        character for character in decomposed if not unicodedata.combining(character)
    )
    return stripped.lower()


def js_string(value: object) -> str:
    """Replicate JavaScript ``String(value)`` for supported metadata values."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return ",".join(js_string(item) for item in value)
    if isinstance(value, dict):
        if "start" in value:
            return str(value.get("start") or "")
        if "name" in value or "title" in value:
            return str(value.get("name") or value.get("title") or "")
        return "[object Object]"
    return str(value)


def compare_field_values(left: object, right: object, direction: str = "asc") -> int:
    """Compare field values with empty-last, numeric and locale-base rules."""
    left_value = js_string(left)
    right_value = js_string(right)
    left_empty = not left_value.strip()
    right_empty = not right_value.strip()
    if left_empty or right_empty:
        if left_empty and right_empty:
            return 0
        return 1 if left_empty else -1
    left_number = (
        parse_numeric_value(left_value) if FULL_NUMERIC_RE.match(left_value.strip()) else None
    )
    right_number = (
        parse_numeric_value(right_value) if FULL_NUMERIC_RE.match(right_value.strip()) else None
    )
    if left_number is not None and right_number is not None:
        comparison = (left_number > right_number) - (left_number < right_number)
    else:
        left_key = collation_key(sort_key(left_value))
        right_key = collation_key(sort_key(right_value))
        comparison = (left_key > right_key) - (left_key < right_key)
    return -comparison if direction == "desc" else comparison


def _metadata_value(row: Row, field: str) -> object:
    metadata = row.get("metadata") or {}
    return metadata.get(field) if isinstance(metadata, dict) else None


def multi_key_sort(rows: Rows, sorts: Sorts | None) -> Rows:
    """Apply stable multi-key sorting, or title sorting when no keys exist."""
    if not sorts:

        def compare_titles(left: Row, right: Row) -> int:
            return compare_field_values(left.get("title"), right.get("title"), "asc")

        return sorted(
            rows,
            key=cmp_to_key(compare_titles),
        )
    result = list(rows)
    for sort in reversed(list(sorts)):
        field = sort.get("field") if isinstance(sort, dict) else None
        if not field:
            continue
        field_name = str(field)
        direction = "desc" if str(sort.get("direction") or "asc") == "desc" else "asc"

        def compare_rows(
            left: Row,
            right: Row,
            selected: str = field_name,
            order: str = direction,
        ) -> int:
            return compare_field_values(
                _metadata_value(left, selected),
                _metadata_value(right, selected),
                order,
            )

        result.sort(key=cmp_to_key(compare_rows))
    return result


__all__ = [
    "SORTKEY_LEAD_RE",
    "collation_key",
    "compare_field_values",
    "js_string",
    "multi_key_sort",
    "sort_key",
]
