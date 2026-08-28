"""Registry, frontmatter and cross-record access for database rules."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

import yaml

from backend.domains.vault.tables.rules.types import (
    FunctionMap,
    Metadata,
    RuleEngineDependencies,
)

ParseMetadata = Callable[[Path], Metadata]
FindRecordPath = Callable[[str], Path | None]


def load_registry(vault_path: Path, logger: logging.Logger) -> Metadata:
    """Load the canonical or legacy Vault registry with an empty fallback."""
    registry_path = vault_path / "BD" / "vault_db_registry.json"
    if not registry_path.exists():
        registry_path = vault_path / "vault_db_registry.json"
    if not registry_path.exists():
        return {"databases": [], "tables": [], "views": []}
    try:
        raw_registry = json.loads(registry_path.read_text(encoding="utf-8"))
        return cast(Metadata, raw_registry) if isinstance(raw_registry, dict) else {}
    except Exception as error:
        logger.error("Error loading registry in RuleEngine: %s", error)
        return {"databases": [], "tables": [], "views": []}


def registry_tables(registry: Metadata) -> list[Metadata]:
    raw_tables = registry.get("tables") or []
    if not isinstance(raw_tables, list):
        return []
    return [cast(Metadata, table) for table in raw_tables if isinstance(table, dict)]


def resolve_table_by_id(registry: Metadata, table_id: object) -> Metadata | None:
    if not table_id:
        return None
    return next((table for table in registry_tables(registry) if table.get("id") == table_id), None)


def resolve_table(registry: Metadata, metadata: Metadata) -> Metadata | None:
    return resolve_table_by_id(
        registry,
        metadata.get("database_table_id") or metadata.get("table_id"),
    )


def find_record_path(
    vault_path: Path,
    record_id: str,
    dependencies: RuleEngineDependencies,
) -> Path | None:
    resolved = dependencies.path_resolver().find_path(record_id, vault_path)
    if resolved:
        return resolved
    direct = vault_path / f"{record_id}.md"
    return direct if direct.exists() else None


def parse_metadata(
    path: Path,
    resolve_table_callback: Callable[[str], Metadata | None],
    dependencies: RuleEngineDependencies,
) -> Metadata:
    """Parse frontmatter and normalize schema-declared relation values."""
    content = path.read_text(encoding="utf-8")
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
    if not match:
        return {}
    try:
        raw_metadata = yaml.safe_load(match.group(1)) or {}
        if not isinstance(raw_metadata, dict):
            return {}
        metadata = cast(Metadata, raw_metadata)
        table_id = metadata.get("table_id") or metadata.get("database_table_id")
        relation_keys = (
            dependencies.relation_keys_from_table(resolve_table_callback(str(table_id)))
            if table_id
            else None
        )
        return dependencies.strip_relation_wikilinks(metadata, relation_keys or None)
    except Exception:
        return {}


def _extend_result(results: list[Any], value: Any) -> None:
    if value is None:
        return
    results.extend(value if isinstance(value, list) else [value])


def _deduplicate(values: list[Any]) -> list[Any]:
    if values and isinstance(values[0], dict):
        return list(values)
    try:
        return list(dict.fromkeys(values))
    except TypeError:
        unique: list[Any] = []
        for value in values:
            if value not in unique:
                unique.append(value)
        return unique


def lookup(
    table_id: str,
    record_ids: object,
    property_name: str,
    cache: dict[tuple[str, str, str], Any],
    find_path: FindRecordPath,
    parse: ParseMetadata,
    logger: logging.Logger,
) -> Any:
    """Look up one field across one or more related record identifiers."""
    if not record_ids:
        return None
    identifiers = record_ids if isinstance(record_ids, list) else [record_ids]
    results: list[Any] = []
    for raw_identifier in identifiers:
        identifier = str(raw_identifier)
        cache_key = (table_id or "", identifier, property_name)
        if cache_key in cache:
            _extend_result(results, cache[cache_key])
            continue
        record_path = find_path(identifier)
        if not record_path:
            cache[cache_key] = None
            continue
        try:
            value = parse(record_path).get(property_name)
            cache[cache_key] = value
            _extend_result(results, value)
        except Exception as error:
            logger.warning("Error in lookup for %s: %s", raw_identifier, error)
            cache[cache_key] = None
    if not results:
        return None
    unique = _deduplicate(results)
    return unique if len(identifiers) > 1 or len(unique) > 1 else (unique[0] if unique else None)


def query(
    vault_path: Path,
    table_id: str,
    filter_expression: str,
    property_name: str | None,
    cache: dict[tuple[str, str, str | None], Any],
    parse: ParseMetadata,
    functions: FunctionMap,
    dependencies: RuleEngineDependencies,
) -> Any:
    """Evaluate a filter expression over all cached rows in one table."""
    cache_key = (table_id, filter_expression, property_name)
    if cache_key in cache:
        return cache[cache_key]
    results: list[Any] = []
    for path in dependencies.path_resolver().list_all_files(vault_path):
        try:
            metadata = parse(path)
            if metadata.get("database_table_id") != table_id:
                continue
            evaluator = dependencies.scoped_evaluator(metadata, functions)
            if evaluator.eval(filter_expression):
                value = (
                    metadata.get(property_name)
                    if property_name
                    else str(metadata.get("id") or path.stem)
                )
                if value:
                    results.append(value)
        except Exception:
            continue
    cache[cache_key] = results
    return results


def normalize_column_values(values: list[Any]) -> list[float]:
    normalized: list[float] = []
    flattened = [
        item for value in values for item in (value if isinstance(value, list) else [value])
    ]
    for value in flattened:
        try:
            normalized.append(float(value))
        except Exception:
            continue
    return normalized


def _row_value(metadata: Metadata, property_name: str) -> object:
    return metadata.get("title") if property_name == "title" else metadata.get(property_name)


def _filter_matches(
    metadata: Metadata,
    expression: str | None,
    functions: FunctionMap,
    dependencies: RuleEngineDependencies,
) -> bool:
    if not expression:
        return True
    evaluator = dependencies.scoped_evaluator(metadata, functions)
    return bool(evaluator.eval(expression))


def _disk_column_values(
    vault_path: Path,
    table_id: str,
    property_name: str,
    filter_expression: str | None,
    current_note_id: str | None,
    parse: ParseMetadata,
    functions: FunctionMap,
    dependencies: RuleEngineDependencies,
) -> list[Any]:
    values: list[Any] = []
    for path in dependencies.path_resolver().list_all_files(vault_path):
        try:
            metadata = parse(path)
            if metadata.get("database_table_id") != table_id:
                continue
            row_id = str(metadata.get("id") or path.stem)
            if current_note_id and row_id == current_note_id:
                continue
            if not _filter_matches(metadata, filter_expression, functions, dependencies):
                continue
            value = _row_value(metadata, property_name)
            if value is not None and value != "":
                values.append(value)
        except Exception:
            continue
    return values


def _current_column_value(
    current_metadata: Metadata,
    table_id: str,
    property_name: str,
    filter_expression: str | None,
    functions: FunctionMap,
    dependencies: RuleEngineDependencies,
) -> object:
    current_table = current_metadata.get("database_table_id") or current_metadata.get("table_id")
    if current_table != table_id:
        return None
    try:
        if not _filter_matches(current_metadata, filter_expression, functions, dependencies):
            return None
    except Exception:
        return None
    value = _row_value(current_metadata, property_name)
    return value if value is not None and value != "" else None


def collect_column_values(
    vault_path: Path,
    table_id: str,
    property_name: str,
    filter_expression: str | None,
    current_note_id: str | None,
    current_metadata: Metadata,
    parse: ParseMetadata,
    functions: FunctionMap,
    dependencies: RuleEngineDependencies,
) -> list[Any]:
    values = _disk_column_values(
        vault_path,
        table_id,
        property_name,
        filter_expression,
        current_note_id,
        parse,
        functions,
        dependencies,
    )
    current = _current_column_value(
        current_metadata,
        table_id,
        property_name,
        filter_expression,
        functions,
        dependencies,
    )
    if current is not None:
        values.append(current)
    return values


__all__ = [
    "collect_column_values",
    "find_record_path",
    "load_registry",
    "lookup",
    "normalize_column_values",
    "parse_metadata",
    "query",
    "registry_tables",
    "resolve_table",
    "resolve_table_by_id",
]
