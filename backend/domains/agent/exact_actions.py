"""Prepare bounded exact assignments from current user text and Vault evidence."""

import json
import math
import re
from typing import Any

from backend.domains.agent.context_matching import _normalized_phrase


def _assignment(message: str) -> tuple[str, str] | None:
    quoted = r'["«“]([^"»”]+)["»”]'
    value_first = re.search(
        r"\b(?:assigna|assignis|assigni|asigna|asignes|asignar|attribue|attribuer)\s+"
        + quoted + r"\s+(?:al|au)\s+(?:camp|campo|champ)\s+([\wÀ-ÿ _-]+)",
        message, re.IGNORECASE,
    )
    if value_first:
        return value_first.group(2).strip(), value_first.group(1).strip()
    field_first = re.search(
        r"\bset\s+(?:the\s+)?([\w _-]+?)\s+field\s+to\s+" + quoted,
        message, re.IGNORECASE,
    )
    return (field_first.group(1).strip(), field_first.group(2).strip()) if field_first else None


def _typed_assignment_value(field: dict[str, Any], value: str) -> Any:
    kind = field.get("type")
    if kind in {"status", "select"}:
        options = [str(option.get("name")) if isinstance(option, dict) else str(option) for option in field.get("options", [])]
        if value not in options:
            raise ValueError("exact_assignment_value_not_allowed")
    elif kind == "checkbox":
        if value.casefold() not in {"true", "false"}:
            raise ValueError("exact_assignment_value_not_allowed")
        return value.casefold() == "true"
    elif kind == "number":
        try:
            typed_value = json.loads(value)
        except ValueError as error:
            raise ValueError("exact_assignment_value_not_allowed") from error
        if type(typed_value) not in {int, float} or not math.isfinite(typed_value):
            raise ValueError("exact_assignment_value_not_allowed")
        return typed_value
    return value


def exact_assignment_call(message: str, content: str) -> dict[str, Any] | None:
    """Use only a complete filtered inventory; execution still needs confirmation."""
    assignment = _assignment(message)
    if assignment is None:
        return None
    payload = json.loads(content)
    if payload.get("error"):
        raise ValueError("exact_assignment_inventory_failed")
    if not payload.get("property_filters"):
        return None
    rows = payload.get("records") or []
    if payload.get("has_more") or int(payload.get("matching_count", 0)) != len(rows) or len(rows) > 100:
        raise ValueError("exact_assignment_inventory_incomplete")
    if not rows:
        raise ValueError("exact_assignment_no_matches")
    name, value = assignment
    schemas = payload.get("field_definitions") or {}
    updates = []
    for row in rows:
        fields = [field for field in schemas.get(row["record_type"]["id"], []) if any(
            _normalized_phrase(field.get(key)) == _normalized_phrase(name) for key in ("id", "name")
        )]
        if len(fields) != 1:
            raise ValueError("exact_assignment_field_not_resolved")
        field = fields[0]
        kind = field.get("type")
        if kind not in {"text", "status", "select", "number", "checkbox"}:
            return None
        typed_value = _typed_assignment_value(field, value)
        updates.append({"id": row["id"], "properties": {field.get("name") or field["id"]: typed_value}})
    return {"name": "bulk_update_rows", "args": {"updates": updates}, "id": "exact-assignment", "type": "tool_call"}
