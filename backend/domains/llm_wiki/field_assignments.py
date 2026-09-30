"""Writable reading-note fields and deterministic value conversion."""
from __future__ import annotations

import math
from copy import deepcopy
from datetime import date, datetime

from backend.domains.vault.registry.records import RecordReader

TEXT_TYPES = {"text", "rich_text", "url", "email", "phone"}
NUMBER_TYPES = {"number", "currency", "percent"}
CATEGORY_TYPES = {"select", "status", "multi_select", "relation"}
COPY_TYPES = {"files", "file", "attachment", "attachments", "image", "autoria", "zotero", "period"}


def is_assignable(prop: RecordReader) -> bool:
    """Calculated fields and the generated page title are owned by the application."""
    name = str(prop.get("name") or "").casefold()
    if name in {"id", "title", "table_id", "parent_id", "note_type"} or name.startswith("llm_wiki_"):
        return False
    return str(prop.get("type") or "") in (
        TEXT_TYPES | NUMBER_TYPES | CATEGORY_TYPES | COPY_TYPES | {"checkbox", "date", "datetime"}
    )


def field_value_schema(field_type: str) -> dict[str, object] | None:
    if field_type in TEXT_TYPES:
        return {"type": "string", "minLength": 1}
    if field_type in NUMBER_TYPES:
        return {"type": "number"}
    if field_type == "checkbox":
        return {"type": "boolean"}
    if field_type in {"date", "datetime"}:
        return {"type": "string", "format": "date" if field_type == "date" else "date-time",
                "description": "ISO 8601 " + field_type}
    return None


def canonical_scalar(field_type: str, raw: object) -> object:
    """Keep zero/false, reject malformed values, and never stringify arbitrary objects."""
    if raw is None or raw == "" or raw == [] or raw == {}:
        return None
    if field_type in TEXT_TYPES:
        return raw.strip() or None if isinstance(raw, str) else None
    if field_type in NUMBER_TYPES:
        if isinstance(raw, bool) or not isinstance(raw, (str, int, float)):
            return None
        try:
            number = float(raw)
            return number if math.isfinite(number) else None
        except (ValueError, OverflowError):
            return None
    if field_type == "checkbox":
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str) and raw.lower() in {"true", "false"}:
            return raw.lower() == "true"
        return None
    if field_type in {"date", "datetime"} and isinstance(raw, str):
        try:
            return date.fromisoformat(raw).isoformat() if field_type == "date" else datetime.fromisoformat(raw).isoformat()
        except ValueError:
            return None
    if field_type in COPY_TYPES and isinstance(raw, (str, list, dict)):
        return deepcopy(raw)
    return None
