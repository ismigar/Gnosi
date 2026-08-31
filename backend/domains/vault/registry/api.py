"""HTTP-independent handlers for the vault registry endpoints."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import HTTPException

from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData
from backend.utils.open_values import iterable_values


@dataclass(frozen=True)
class RegistryApiDependencies:
    load_registry: Callable[[], RegistryData]
    save_registry: Callable[[RegistryData], None]
    sort_key: Callable[[RegistryData], tuple[int, str]]
    safe_error_detail: Callable[[Exception, str], str]
    logger: logging.Logger


async def get_registry(dependencies: RegistryApiDependencies) -> RegistryData:
    try:
        registry = dependencies.load_registry()
        response = dict(registry)
        databases = registry.get("databases", [])
        tables = registry.get("tables", [])
        views = registry.get("views", [])
        response["databases"] = sorted(
            [item for item in iterable_values(databases) if is_record(item)],
            key=dependencies.sort_key,
        )
        response["tables"] = sorted(
            [
                item
                for item in iterable_values(tables)
                if is_record(item) and str(item.get("id") or "").strip().lower() != "wiki"
            ],
            key=dependencies.sort_key,
        )
        response["views"] = [item for item in iterable_values(views) if is_record(item)]
        return response
    except Exception as error:
        dependencies.logger.exception("ERROR in get_registry: %s", error)
        raise HTTPException(
            status_code=500,
            detail=dependencies.safe_error_detail(error, "GET /registry"),
        ) from error


async def update_registry(
    data: RegistryData,
    dependencies: RegistryApiDependencies,
) -> RegistryData:
    dependencies.save_registry(data)
    return {"status": "success"}


def table_by_id(
    table_id: str | None,
    dependencies: RegistryApiDependencies,
) -> RegistryData | None:
    """Return one registry table by immutable ID."""
    if not table_id:
        return None
    try:
        registry = dependencies.load_registry()
        tables = registry.get("tables", [])
        return next(
            (table for table in iterable_values(tables) if is_record(table) and table.get("id") == table_id),
            None,
        )
    except Exception:
        return None


__all__ = [
    "RegistryApiDependencies",
    "get_registry",
    "table_by_id",
    "update_registry",
]
