"""Lossless normalization and field-reference migration for unified dates."""

from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime
from typing import Any


def formula_date_value(value: object) -> object:
    """Keep historical date formulas reading the primary boundary of a tagged date."""
    if isinstance(value, dict) and value.get("kind") in {"point", "period"}:
        start = value.get("start") or ""
        return str(start).partition("T")[0] if value.get("withTime") is False else start
    return value


def normalize_date(value: Any, legacy_type: str = "date") -> dict[str, Any]:
    """Keep clocks, planning data and unknown extensions in one tagged value."""
    source = deepcopy(value) if isinstance(value, dict) else {}
    if isinstance(value, dict):
        start, end = value.get("start") or "", value.get("end") or ""
    else:
        text = value.isoformat() if isinstance(value, (date, datetime)) else str(value or "")
        start, _, end = text.partition("/")
    start = start.isoformat() if isinstance(start, (date, datetime)) else str(start)
    end = end.isoformat() if isinstance(end, (date, datetime)) else str(end)
    kind = source.get("kind")
    if kind not in {"point", "period"}:
        kind = "period" if legacy_type == "period" or end or "/" in str(value) else "point"
    with_time = source.get("withTime")
    if not isinstance(with_time, bool):
        with_time = legacy_type == "datetime" or "T" in start or "T" in end
    return {"startMode": "manual", "endMode": "manual", "mode": "manual",
            **source, "version": 3, "kind": kind, "withTime": with_time,
            "start": start, "end": end}


def merge_dates(data: Any, period: Any, *, period_with_time: bool | None = None) -> dict[str, Any] | None:
    """Prefer real period facts, preserving every differing source for review."""
    has_date, has_period = data not in (None, ""), period not in (None, "")
    if not has_date and not has_period:
        return None
    if not has_period or (has_date and data == period):
        return normalize_date(data)
    result = normalize_date(period, "period")
    if isinstance(period, dict) and period_with_time is not None and "withTime" not in period:
        result["withTime"] = period_with_time
    if has_date:
        original = normalize_date(data)
        if (original["start"], original["end"]) != (result["start"], result["end"]):
            result["legacyValues"] = {"Data": deepcopy(data), "Període": deepcopy(period)}
    return result


_LIST_REFS = {"visibleProperties", "visible_properties", "columns"}
_SCALAR_REFS = {"field", "dateField", "endDateField", "groupBy", "groupSort", "colorField",
                "coverField", "relationField", "targetProperty", "predecessorField"}
_MAP_REFS = {"columnWidths", "aggregations"}


def remap_date_references(value: Any, replacements: dict[str, str]) -> Any:
    """Rewrite references, keeping literal filter values and unrelated text intact."""
    if isinstance(value, list):
        return [remap_date_references(item, replacements) for item in value]
    if not isinstance(value, dict):
        return value
    result: dict[str, Any] = {}
    for key, item in value.items():
        if key in _SCALAR_REFS and isinstance(item, str):
            result[key] = replacements.get(item, item)
        elif key in _LIST_REFS and isinstance(item, list):
            rewritten = [replacements.get(ref, ref) if isinstance(ref, str) else ref for ref in item]
            result[key] = list(dict.fromkeys(rewritten))
        elif key in _MAP_REFS and isinstance(item, dict):
            result[key] = {replacements.get(ref, ref): val for ref, val in item.items()}
        elif key in {"formula", "compute", "defaultFormula"} and isinstance(item, str):
            for old, new in replacements.items():
                for before, after in [(f'prop("{old}")', f'prop("{new}")'),
                                      (f"prop('{old}')", f"prop('{new}')"),
                                      ("{" + old + "}", "{" + new + "}")]:
                    item = item.replace(before, after)
            result[key] = item
        else:
            result[key] = remap_date_references(item, replacements)
    return result


def remap_scoped_date_references(value: Any, table_id: str, replacements: dict[str, str]) -> Any:
    """Named fields belong to one table; IDs can be rewritten across tables."""
    if isinstance(value, list):
        return [remap_scoped_date_references(item, table_id, replacements) for item in value]
    if not isinstance(value, dict):
        return value
    mapping = replacements if (value.get("table_id") or value.get("tableId")
                               or value.get("database_table_id")) == table_id else {
        old: new for old, new in replacements.items() if old.startswith("fld_")}
    result = remap_date_references(value, mapping)
    # Revisit embedded table sections with their own scope.
    for key, item in value.items():
        if isinstance(item, (dict, list)) and key not in _MAP_REFS | _LIST_REFS:
            if mapping == replacements:
                result[key] = remap_date_references(item, mapping)
            else:
                result[key] = remap_scoped_date_references(item, table_id, replacements)
    return result
