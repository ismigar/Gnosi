"""Database and table collection operations."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass

from backend.domains.vault.registry.records import is_object_list, is_record
from backend.domains.vault.registry.state import RegistryData
from backend.utils.open_values import iterable_values


@dataclass(frozen=True)
class TableCollectionDependencies:
    load_registry: Callable[[], RegistryData]
    save_registry: Callable[[RegistryData], None]
    registry_mutation: Callable[[], AbstractContextManager[None]]
    sort_key: Callable[[RegistryData], tuple[int, str]]


async def list_databases(
    dependencies: TableCollectionDependencies,
) -> list[RegistryData]:
    return await asyncio.to_thread(_list_databases, dependencies)


def _list_databases(
    dependencies: TableCollectionDependencies,
) -> list[RegistryData]:
    registry = dependencies.load_registry()
    raw_databases = registry.get("databases", [])
    databases = [item for item in iterable_values(raw_databases) if is_record(item)]
    return sorted(databases, key=dependencies.sort_key)


async def create_database(
    database: RegistryData,
    dependencies: TableCollectionDependencies,
) -> RegistryData:
    with dependencies.registry_mutation():
        registry = dependencies.load_registry()
        if "id" not in database:
            database["id"] = str(uuid.uuid4())
        raw_databases = registry.setdefault("databases", [])
        databases = raw_databases if is_object_list(raw_databases) else []
        existing_index = next(
            (
                index
                for index, item in enumerate(databases)
                if is_record(item) and item["id"] == database["id"]
            ),
            None,
        )
        if existing_index is not None:
            databases[existing_index] = database
        else:
            databases.append(database)
        registry["databases"] = databases
        dependencies.save_registry(registry)
    return database


async def delete_database(
    database_id: str,
    dependencies: TableCollectionDependencies,
) -> RegistryData:
    with dependencies.registry_mutation():
        registry = dependencies.load_registry()
        raw_databases = registry.get("databases", [])
        raw_tables = registry.get("tables", [])
        raw_views = registry.get("views", [])
        databases = [item for item in iterable_values(raw_databases) if is_record(item)]
        tables = [item for item in iterable_values(raw_tables) if is_record(item)]
        views = [item for item in iterable_values(raw_views) if is_record(item)]
        _remove_database_children(
            registry,
            database_id,
            databases,
            tables,
            views,
        )
        dependencies.save_registry(registry)
    return {"status": "success"}


def _remove_database_children(
    registry: RegistryData,
    database_id: str,
    databases: list[RegistryData],
    tables: list[RegistryData],
    views: list[RegistryData],
) -> None:
    registry["databases"] = [item for item in databases if item.get("id") != database_id]
    table_ids = {str(item["id"]) for item in tables if item.get("database_id") == database_id}
    registry["tables"] = [item for item in tables if item.get("database_id") != database_id]
    registry["views"] = [item for item in views if str(item.get("table_id")) not in table_ids]


async def list_tables(
    database_id: str | None,
    dependencies: TableCollectionDependencies,
) -> list[RegistryData]:
    return await asyncio.to_thread(_list_tables, database_id, dependencies)


def _list_tables(
    database_id: str | None,
    dependencies: TableCollectionDependencies,
) -> list[RegistryData]:
    registry = dependencies.load_registry()
    raw_tables = registry.get("tables", [])
    tables = [
        item
        for item in iterable_values(raw_tables)
        if is_record(item) and str(item.get("id") or "").strip().lower() != "wiki"
    ]
    if database_id:
        tables = [item for item in tables if item.get("database_id") == database_id]
    return sorted(tables, key=dependencies.sort_key)


__all__ = [
    "TableCollectionDependencies",
    "create_database",
    "delete_database",
    "list_databases",
    "list_tables",
]
