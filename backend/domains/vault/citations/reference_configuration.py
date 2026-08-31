"""Canonical reference-table designation and legacy auto-adoption."""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path

from backend.domains.vault.citations.export_contracts import ReferenceRegistry, ReferenceTable

Metadata = dict[str, object]


@dataclass(frozen=True)
class ReferenceConfigurationDependencies:
    """Configuration and registry ports for reference-table resolution."""

    config_path: Path
    defaults: Metadata
    config_lock: AbstractContextManager[object]
    load_json: Callable[[Path, Metadata], Mapping[str, object] | None]
    save_json: Callable[[Path, Metadata], None]
    load_registry: Callable[[], ReferenceRegistry]
    citation_key_property: Callable[[ReferenceTable], str | None]
    logger: logging.Logger


def _config(dependencies: ReferenceConfigurationDependencies) -> Metadata:
    loaded = dependencies.load_json(dependencies.config_path, {}) or {}
    return {**dependencies.defaults, **loaded}


def _configured_target(config: Metadata) -> str | None:
    target = str(config.get("target_table") or "").strip()
    return target or None


def _citable_table(
    registry: ReferenceRegistry,
    dependencies: ReferenceConfigurationDependencies,
) -> ReferenceTable | None:
    tables = registry.get("tables")
    if not isinstance(tables, list):
        return None
    for raw_table in tables:
        if not isinstance(raw_table, dict):
            continue
        if dependencies.citation_key_property(raw_table):
            return raw_table
    return None


def _adopt_table(
    table: ReferenceTable,
    dependencies: ReferenceConfigurationDependencies,
) -> str | None:
    adopted = str(table.get("id") or "").strip()
    if not adopted:
        return None
    with dependencies.config_lock:
        config = _config(dependencies)
        current = _configured_target(config)
        if current:
            return current
        if config.get("references_configured"):
            return None
        config["target_table"] = adopted
        try:
            dependencies.save_json(dependencies.config_path, config)
        except Exception:
            pass
    dependencies.logger.info(
        "📚 Automatically assigned references table: %s (%s)",
        adopted,
        table.get("name"),
    )
    return adopted


def reference_table_id(
    dependencies: ReferenceConfigurationDependencies,
) -> str | None:
    """Return the configured table, or adopt one legacy citable table once."""
    config = _config(dependencies)
    target = _configured_target(config)
    if target:
        return target
    if config.get("references_configured"):
        return None
    try:
        table = _citable_table(dependencies.load_registry(), dependencies)
        return _adopt_table(table, dependencies) if table else None
    except Exception:
        return None


__all__ = [
    "Metadata",
    "ReferenceConfigurationDependencies",
    "reference_table_id",
]
