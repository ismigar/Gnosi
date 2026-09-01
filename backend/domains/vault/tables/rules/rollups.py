"""Related-row collection and rollup aggregation."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from backend.domains.vault.tables.rules.definitions import (
    as_datetime,
    is_truthy_checkbox,
    normalize_record_ids,
)
from backend.domains.vault.tables.rules.types import (
    Definition,
    FunctionMap,
    Metadata,
    RuleEngineDependencies,
)


def _passes_filter(
    metadata: Metadata,
    expression: object,
    functions: FunctionMap,
    dependencies: RuleEngineDependencies,
) -> bool:
    if not expression:
        return True
    try:
        evaluator = dependencies.scoped_evaluator(metadata, functions)
        return bool(evaluator.eval(str(expression)))
    except Exception:
        return False


def _apply_limit(
    rows: list[Metadata],
    values: list[Any],
    raw_limit: object,
) -> tuple[list[Metadata], list[Any]]:
    try:
        if raw_limit is None:
            return rows, values
        if not isinstance(raw_limit, (str, bytes, bytearray, int, float)):
            return rows, values
        limit = int(raw_limit)
        return (rows[:limit], values[:limit]) if limit >= 0 else (rows, values)
    except Exception:
        return rows, values


def collect_rollup_values(
    definition: Definition,
    updated_metadata: Metadata,
    load_related_metadata: Callable[[str], Metadata | None],
    functions: FunctionMap,
    dependencies: RuleEngineDependencies,
) -> tuple[list[Metadata], list[Any]]:
    """Load, filter and bound rows referenced by one rollup field."""
    relation_field = str(definition.get("relation_field") or "")
    record_ids = normalize_record_ids(updated_metadata.get(relation_field))
    filter_expression = definition.get("filter_expression")
    target_property = definition.get("target_property")
    rows: list[Metadata] = []
    values: list[Any] = []
    for record_id in record_ids:
        metadata = load_related_metadata(record_id)
        if not metadata or not _passes_filter(
            metadata,
            filter_expression,
            functions,
            dependencies,
        ):
            continue
        rows.append(metadata)
        if target_property == "title":
            values.append(metadata.get("title"))
        elif target_property:
            values.append(metadata.get(str(target_property)))
    return _apply_limit(rows, values, definition.get("limit"))


def _flatten(values: list[Any]) -> list[Any]:
    flattened: list[Any] = []
    for value in values:
        flattened.extend(value if isinstance(value, list) else [value])
    return flattened


def _token(value: object) -> str:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True)
        if isinstance(value, dict)
        else str(value)
    )


def _unique(values: list[Any]) -> list[Any]:
    unique: list[Any] = []
    seen: set[str] = set()
    for value in values:
        token = _token(value)
        if token not in seen:
            seen.add(token)
            unique.append(value)
    return unique


def _fallback(definition: Definition, default: Any) -> Any:
    provided = "fallback_value" in definition and definition.get("fallback_value") is not None
    return definition.get("fallback_value") if provided else default


def _count_aggregation(
    aggregation: str,
    rows: list[Metadata],
    flattened: list[Any],
    non_empty: list[Any],
    definition: Definition,
) -> Any:
    if aggregation == "count_all":
        return len(rows)
    if aggregation == "count_values":
        return len(non_empty)
    if aggregation == "show_original":
        return _unique(non_empty) if non_empty else _fallback(definition, [])
    if aggregation == "unique_count":
        return (
            len({_token(value) for value in non_empty}) if non_empty else _fallback(definition, 0)
        )
    if aggregation == "percent_checked":
        if not flattened:
            return _fallback(definition, 0)
        checked = sum(1 for value in flattened if is_truthy_checkbox(value))
        return round((checked * 100.0) / len(flattened), 2)
    return None


def _date_aggregation(
    aggregation: str,
    non_empty: list[Any],
    definition: Definition,
) -> Any:
    dates = [date_value for value in non_empty if (date_value := as_datetime(value)) is not None]
    if not dates:
        return _fallback(definition, None)
    selected = min(dates) if aggregation == "earliest" else max(dates)
    return selected.isoformat()


def _numeric_values(values: list[Any]) -> list[float]:
    numbers: list[float] = []
    for value in values:
        try:
            numbers.append(float(value))
        except Exception:
            continue
    return numbers


def _numeric_aggregation(
    aggregation: str,
    values: list[float],
    definition: Definition,
) -> Any:
    if aggregation not in {"sum", "avg", "min", "max"}:
        return _fallback(definition, None)
    if not values:
        default = None if aggregation in ("min", "max") else 0
        return _fallback(definition, default)
    if aggregation == "sum":
        return sum(values)
    if aggregation == "avg":
        return sum(values) / len(values)
    if aggregation == "min":
        return min(values)
    if aggregation == "max":
        return max(values)
    return _fallback(definition, None)


def evaluate_rollup_definition(
    definition: Definition,
    rows: list[Metadata],
    values: list[Any],
) -> Any:
    """Evaluate one supported rollup aggregation with legacy fallbacks."""
    aggregation = str(definition.get("aggregation", "count_values"))
    flattened = _flatten(values)
    non_empty = [value for value in flattened if value is not None and value != ""]
    if aggregation in {
        "count_all",
        "count_values",
        "show_original",
        "unique_count",
        "percent_checked",
    }:
        return _count_aggregation(aggregation, rows, flattened, non_empty, definition)
    if aggregation in {"earliest", "latest"}:
        return _date_aggregation(aggregation, non_empty, definition)
    return _numeric_aggregation(aggregation, _numeric_values(non_empty), definition)


__all__ = ["collect_rollup_values", "evaluate_rollup_definition"]
