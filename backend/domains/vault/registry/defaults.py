"""Guarded initialization of a new vault registry."""

from __future__ import annotations

import logging
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path

from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData, RegistryState
from backend.utils.open_values import append_value, iterable_values


@dataclass(frozen=True)
class DefaultRegistryDependencies:
    load_registry: Callable[[], RegistryData]
    save_registry: Callable[[RegistryData], None]
    registry_mutation: Callable[[], AbstractContextManager[None]]
    registry_path: Callable[[], Path | None]
    overwrite_is_risky: Callable[[Path], bool]
    state: RegistryState
    logger: logging.Logger


def _seed_is_risky(
    registry: RegistryData,
    dependencies: DefaultRegistryDependencies,
) -> Path | None:
    if registry["databases"] or registry["tables"]:
        return None
    registry_path = dependencies.registry_path()
    if (
        registry_path
        and str(registry_path) not in dependencies.state.seen_nondegenerate
        and dependencies.overwrite_is_risky(registry_path)
    ):
        return registry_path
    return None


def _ensure_default_database(registry: RegistryData) -> bool:
    databases = registry["databases"]
    database = next(
        (
            item
            for item in iterable_values(databases)
            if is_record(item) and item.get("id") == "gnosi_vault_db"
        ),
        None,
    )
    if database is None:
        append_value(databases,
            {
                "id": "gnosi_vault_db",
                "name": "Gnosi Vault",
                "folder": "Databases/Gnosi",
            }
        )
        return True
    changed = False
    if database.get("name") != "Gnosi Vault":
        database["name"] = "Gnosi Vault"
        changed = True
    if database.get("folder") != "Databases/Gnosi":
        database["folder"] = "Databases/Gnosi"
        changed = True
    return changed


def ensure_default_registry_structure(
    dependencies: DefaultRegistryDependencies,
) -> None:
    """Ensure a guarded default database exists for a genuinely new vault."""
    with dependencies.registry_mutation():
        registry = dependencies.load_registry()
        for key in ("databases", "tables", "views"):
            if not isinstance(registry.get(key), list):
                registry[key] = []
        risky_path = _seed_is_risky(registry, dependencies)
        if risky_path:
            dependencies.logger.error(
                "🛑 Default registry seed aborted: the registry reads empty but "
                "the vault shows existing data next to %s. Leaving the file "
                "untouched (likely a cloud-sync misread; restore from a .bak-* "
                "if needed).",
                risky_path,
            )
            return
        if _ensure_default_database(registry):
            dependencies.save_registry(registry)


__all__ = ["DefaultRegistryDependencies", "ensure_default_registry_structure"]
