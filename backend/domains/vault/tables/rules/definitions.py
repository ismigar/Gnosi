"""Extraction and dependency ordering of formulas and rollups."""

from __future__ import annotations

import datetime as datetime_module
import logging
import re
from collections import deque
from datetime import datetime

from backend.domains.vault.registry.records import is_object_list, is_record
from backend.domains.vault.tables.rules.types import Definition, Metadata

RESERVED_FORMULA_NAMES = {
    "prop",
    "lookup",
    "query",
    "first",
    "last",
    "len",
    "sum",
    "avg",
    "min",
    "max",
    "abs",
    "round",
    "ceil",
    "floor",
    "col_sum",
    "col_avg",
    "col_count",
    "col_min",
    "col_max",
    "and",
    "or",
    "not",
    "true",
    "false",
    "none",
}


def canonical_for_compare(value: object) -> object:
    """Normalize YAML temporal values to their request-side ISO spelling."""
    if isinstance(
        value,
        (datetime_module.datetime, datetime_module.date, datetime_module.time),
    ):
        return value.isoformat()
    return value


def expression_has_cross_record_calls(expression: str) -> bool:
    normalized = str(expression).lower() if expression else ""
    return "lookup(" in normalized or "query(" in normalized


def _property_config(prop: Metadata, key: str) -> Metadata:
    value = prop.get(key)
    return value if is_record(value) else {}


def _formula_definition(prop: Metadata) -> Definition | None:
    name = prop.get("name")
    if not name:
        return None
    config = _property_config(prop, "config")
    formula_config = _property_config(prop, "formula_config")
    expression = prop.get("formula") or formula_config.get("expression") or config.get("formula")
    default_expression = (
        prop.get("defaultFormula")
        or formula_config.get("defaultFormula")
        or config.get("defaultFormula")
    )
    if expression and prop.get("type") == "formula":
        return {"name": name, "expression": expression, "mode": "always"}
    if default_expression:
        return {"name": name, "expression": default_expression, "mode": "missing"}
    return None


def extract_formula_definitions(table: Metadata) -> list[Definition]:
    properties = table.get("properties") or []
    if not is_object_list(properties):
        return []
    definitions: list[Definition] = []
    for raw_prop in properties:
        definition = _formula_definition(raw_prop) if is_record(raw_prop) else None
        if definition:
            definitions.append(definition)
    return definitions


def _rollup_definition(prop: Metadata) -> Definition | None:
    name = prop.get("name")
    if not name or prop.get("type") != "rollup":
        return None
    config = _property_config(prop, "config")
    rollup = _property_config(prop, "rollup")
    relation_field = (
        prop.get("relationField") or config.get("relationField") or rollup.get("relationField")
    )
    target_property = (
        prop.get("targetProperty") or config.get("targetProperty") or rollup.get("targetProperty")
    )
    aggregation = (
        prop.get("aggregation")
        or config.get("aggregation")
        or rollup.get("aggregation")
        or "count_values"
    )
    if not relation_field or (aggregation != "count_all" and not target_property):
        return None
    fallback = (
        prop.get("fallbackValue")
        if "fallbackValue" in prop
        else config.get("fallbackValue", rollup.get("fallbackValue"))
    )
    return {
        "name": name,
        "relation_field": relation_field,
        "target_property": target_property,
        "aggregation": str(aggregation).strip().lower(),
        "filter_expression": prop.get("filterExpression")
        or config.get("filterExpression")
        or rollup.get("filterExpression"),
        "limit": prop.get("limit") or config.get("limit") or rollup.get("limit"),
        "fallback_value": fallback,
    }


def extract_rollup_definitions(table: Metadata) -> list[Definition]:
    properties = table.get("properties") or []
    if not is_object_list(properties):
        return []
    definitions: list[Definition] = []
    for raw_prop in properties:
        definition = _rollup_definition(raw_prop) if is_record(raw_prop) else None
        if definition:
            definitions.append(definition)
    return definitions


def extract_dependencies(expression: str, known_fields: set[str], field_name: str) -> set[str]:
    dependencies: set[str] = set()
    if not expression:
        return dependencies
    for raw_name in re.findall(r"\{([^}]+)\}", expression):
        name = (raw_name or "").strip()
        if name in known_fields and name != field_name:
            dependencies.add(name)
    for raw_name in re.findall(r"prop\(\s*['\"]([^'\"]+)['\"]\s*\)", expression):
        name = (raw_name or "").strip()
        if name in known_fields and name != field_name:
            dependencies.add(name)
    for identifier in re.findall(r"\b[A-Za-z_][A-Za-z0-9_]*\b", expression):
        if (
            identifier not in RESERVED_FORMULA_NAMES
            and identifier in known_fields
            and identifier != field_name
        ):
            dependencies.add(identifier)
    return dependencies


def definition_dependencies(definition: Definition, known_fields: set[str]) -> set[str]:
    name = str(definition.get("name") or "")
    if definition.get("kind") == "rollup":
        relation_field = str(definition.get("relation_field") or "")
        return (
            {relation_field}
            if relation_field and relation_field != name and relation_field in known_fields
            else set()
        )
    return extract_dependencies(str(definition.get("expression") or ""), known_fields, name)


def order_definitions(
    definitions: list[Definition],
    logger: logging.Logger,
) -> tuple[list[Definition], list[Definition]]:
    """Topologically order mixed derived fields and return any cycle."""
    if not definitions:
        return [], []
    by_name = {str(definition["name"]): definition for definition in definitions}
    known = set(by_name)
    dependencies = {
        name: definition_dependencies(definition, known) for name, definition in by_name.items()
    }
    indegree = {name: len(names) for name, names in dependencies.items()}
    outgoing: dict[str, set[str]] = {name: set() for name in by_name}
    for name, names in dependencies.items():
        for dependency in names:
            outgoing[dependency].add(name)
    queue = deque(sorted(name for name, degree in indegree.items() if degree == 0))
    ordered_names: list[str] = []
    while queue:
        current = queue.popleft()
        ordered_names.append(current)
        for following in sorted(outgoing[current]):
            indegree[following] -= 1
            if indegree[following] == 0:
                queue.append(following)
    cycle_names = [name for name in by_name if name not in ordered_names]
    if cycle_names:
        logger.warning(
            "RuleEngine detected derived-field cycle (formula/rollup) for fields: %s",
            cycle_names,
        )
    return (
        [by_name[name] for name in ordered_names],
        [by_name[name] for name in cycle_names],
    )


def normalize_record_ids(record_ids: object) -> list[str]:
    if record_ids is None or record_ids == "":
        return []
    if is_object_list(record_ids):
        return [str(record_id).strip() for record_id in record_ids if str(record_id).strip()]
    if isinstance(record_ids, str) and "," in record_ids:
        return [record_id.strip() for record_id in record_ids.split(",") if record_id.strip()]
    return [str(record_ids).strip()]


def is_truthy_checkbox(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value or "").strip().lower() in {
        "true",
        "1",
        "yes",
        "si",
        "sí",
        "done",
        "checked",
        "completat",
    }


def as_datetime(value: object) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None


__all__ = [
    "as_datetime",
    "canonical_for_compare",
    "definition_dependencies",
    "expression_has_cross_record_calls",
    "extract_dependencies",
    "extract_formula_definitions",
    "extract_rollup_definitions",
    "is_truthy_checkbox",
    "normalize_record_ids",
    "order_definitions",
]
