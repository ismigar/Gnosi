"""Best-effort persistence of status values created by action rules."""

from __future__ import annotations

import logging
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass

from backend.domains.vault.registry.records import is_object_list, is_record
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.tables.catalogs.types import Option


Metadata = RegistryData
WantedOption = tuple[str, str]


@dataclass(frozen=True)
class StatusOptionDependencies:
    """Registry and option-catalog ports required by persistence."""

    registry_mutation: Callable[[], AbstractContextManager[None]]
    load_registry: Callable[[], Metadata]
    save_registry: Callable[[Metadata], None]
    find_role_property: Callable[[Metadata, str], Metadata | None]
    status_role: str
    is_global_status_property: Callable[[Metadata], bool]
    status_catalog_reference: str
    normalize_options: Callable[[object], list[Option]]
    auto_color: Callable[[str], str]
    ensure_options_exist: Callable[[Metadata, list[WantedOption]], bool]
    logger: logging.Logger


def _mapping(value: object) -> Metadata:
    return value if is_record(value) else {}


def _table(registry: Metadata, table_id: str) -> Metadata | None:
    tables = registry.get("tables")
    if not is_object_list(tables):
        return None
    return next(
        (
            table
            for table in tables
            if is_record(table) and table.get("id") == table_id
        ),
        None,
    )


def _wanted(values: list[object]) -> list[WantedOption]:
    return [(str(value), "") for value in values if str(value or "").strip()]


def _global_catalog(registry: Metadata, reference: str) -> list[object]:
    catalogs = _mapping(registry.setdefault("option_catalogs", {}))
    raw_catalog = catalogs.setdefault(reference, [])
    catalog = raw_catalog if is_object_list(raw_catalog) else []
    catalogs[reference] = catalog
    registry["option_catalogs"] = catalogs
    return catalog


def _append_global_options(
    registry: Metadata,
    wanted: list[WantedOption],
    dependencies: StatusOptionDependencies,
) -> bool:
    catalog = _global_catalog(registry, dependencies.status_catalog_reference)
    normalized = dependencies.normalize_options(catalog)
    names = {str(option["name"]) for option in normalized if option.get("name")}
    changed = False
    for value, group in wanted:
        if value in names:
            continue
        option: Option = {"name": value, "color": dependencies.auto_color(value)}
        if group:
            option["group"] = group
        catalog.append(option)
        names.add(value)
        changed = True
    if not changed:
        return False
    catalogs = _mapping(registry["option_catalogs"])
    catalogs[dependencies.status_catalog_reference] = dependencies.normalize_options(catalog)
    return True


def ensure_status_options_persisted(
    table_id: str,
    values: list[object],
    dependencies: StatusOptionDependencies,
) -> None:
    """Persist missing status options without propagating registry failures."""
    try:
        with dependencies.registry_mutation():
            registry = dependencies.load_registry()
            table = _table(registry, table_id)
            if not table:
                return
            prop = dependencies.find_role_property(table, dependencies.status_role)
            wanted = _wanted(values)
            if not prop or not wanted:
                return
            if dependencies.is_global_status_property(prop):
                changed = _append_global_options(registry, wanted, dependencies)
            else:
                changed = dependencies.ensure_options_exist(prop, wanted)
            if changed:
                dependencies.save_registry(registry)
    except Exception as error:
        dependencies.logger.warning(
            "action_rules: could not persist the expanded catalog for %s: %s",
            table_id,
            error,
        )


__all__ = [
    "Metadata",
    "StatusOptionDependencies",
    "WantedOption",
    "ensure_status_options_persisted",
]
