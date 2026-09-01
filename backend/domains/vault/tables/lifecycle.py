"""Table creation, deletion and rename services."""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from fastapi import BackgroundTasks, HTTPException

from backend.domains.vault.registry.names import (
    normalize_registry_table_view_names,
    normalize_table_view_name,
)
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.tables.schema import (
    ensure_main_view,
    reconcile_table_schema_revision,
)


AssetMoves = list[tuple[Path, Path]]
DeferredRewrite = tuple[Path, str, str] | None


class FallbackSanitizer(Protocol):
    def __call__(self, value: object, *, fallback: str) -> str: ...


@dataclass(frozen=True)
class CreateTableDependencies:
    load_registry: Callable[[], RegistryData]
    save_registry: Callable[[RegistryData], None]
    registry_mutation: Callable[[], AbstractContextManager[None]]
    configured_language: Callable[[], str]
    ensure_system_dates: Callable[[RegistryData, str], object]
    normalize_folder: Callable[[str | None], str]
    sanitize_folder: FallbackSanitizer
    is_asset_property: Callable[[RegistryData], bool]
    delete_asset_property: Callable[[RegistryData, RegistryData | None, str], object]
    ensure_asset_directories: Callable[[RegistryData, RegistryData], object]
    ensure_table_folder: Callable[[RegistryData, RegistryData], object]
    ensure_table_seeds: Callable[[RegistryData], object]
    ensure_global_status_catalog: Callable[[RegistryData], object]
    ensure_action_rules: Callable[[RegistryData], object]


@dataclass(frozen=True)
class DeleteTableDependencies:
    load_registry: Callable[[], RegistryData]
    save_registry: Callable[[RegistryData], None]
    registry_mutation: Callable[[], AbstractContextManager[None]]
    vault_root: Callable[[], Path]
    stable_revision: Callable[[object], str]
    views_revision: Callable[[RegistryData, str], str]
    quarantine_assets: Callable[[RegistryData, RegistryData | None], tuple[Path | None, AssetMoves]]
    quarantined_revision: Callable[[RegistryData, RegistryData | None, AssetMoves], str]
    restore_quarantine: Callable[[Path | None, AssetMoves], object]
    mark_quarantine_ready: Callable[[Path], Path]
    delete_quarantine: Callable[[Path, Path], object]
    logger: logging.Logger


@dataclass(frozen=True)
class RenameTableDependencies:
    load_registry: Callable[[], RegistryData]
    save_registry: Callable[[RegistryData], None]
    registry_mutation: Callable[[], AbstractContextManager[None]]
    assets_root: Callable[[], Path]
    sanitize_title: FallbackSanitizer
    sanitize_folder: FallbackSanitizer
    sanitize_asset_segment: Callable[[object, str], str]
    asset_segments_collide: Callable[[str, str], bool]
    move_loose_files: Callable[[Path, Path], int]
    table_vault_directory: Callable[[RegistryData, RegistryData], Path | None]
    ensure_asset_directories: Callable[[RegistryData, RegistryData], object]
    ensure_table_folder: Callable[[RegistryData, RegistryData], object]
    rewrite_inline_asset_refs: Callable[[Path, str, str], int]
    logger: logging.Logger


def _registry_items(registry: RegistryData, key: str) -> list[RegistryData]:
    raw_items = registry.get(key, [])
    return [item for item in raw_items if isinstance(item, dict)]


def _preserve_property_aliases(
    old_table: RegistryData,
    incoming_table: RegistryData,
) -> None:
    old_by_id = {
        prop.get("id"): prop for prop in _registry_items(old_table, "properties") if prop.get("id")
    }
    for prop in _registry_items(incoming_table, "properties"):
        old_property = old_by_id.get(prop.get("id"))
        if old_property and old_property.get("aliases") and not prop.get("aliases"):
            prop["aliases"] = list(old_property["aliases"])


def _asset_property_names(
    table: RegistryData,
    dependencies: CreateTableDependencies,
) -> set[str]:
    return {
        str(prop.get("name") or "").strip()
        for prop in _registry_items(table, "properties")
        if dependencies.is_asset_property(prop) and str(prop.get("name") or "").strip()
    }


def _delete_removed_asset_properties(
    old_table: RegistryData,
    incoming_table: RegistryData,
    registry: RegistryData,
    dependencies: CreateTableDependencies,
) -> None:
    removed = _asset_property_names(old_table, dependencies) - _asset_property_names(
        incoming_table, dependencies
    )
    database = next(
        (
            item
            for item in _registry_items(registry, "databases")
            if str(item.get("id")) == str(old_table.get("database_id"))
        ),
        None,
    )
    for property_name in removed:
        dependencies.delete_asset_property(old_table, database, property_name)


def _upsert_table(
    registry: RegistryData,
    table: RegistryData,
    dependencies: CreateTableDependencies,
) -> None:
    tables = _registry_items(registry, "tables")
    existing_index = next(
        (index for index, item in enumerate(tables) if item["id"] == table["id"]),
        None,
    )
    if existing_index is None:
        tables.append(table)
    else:
        old_table = tables[existing_index]
        _preserve_property_aliases(old_table, table)
        reconcile_table_schema_revision(old_table, table)
        _delete_removed_asset_properties(old_table, table, registry, dependencies)
        tables[existing_index] = table
    registry["tables"] = tables


def create_table_locked(
    table: RegistryData,
    dependencies: CreateTableDependencies,
) -> RegistryData:
    registry = dependencies.load_registry()
    locale_value = table.pop("locale", None) or table.pop("language", None)
    locale = str(locale_value or dependencies.configured_language() or "en")
    if "id" not in table:
        table["id"] = str(uuid.uuid4())
    table["name"] = normalize_table_view_name(
        table.get("name") or table.get("id"), "Untitled Table"
    )
    dependencies.ensure_system_dates(table, locale)
    folder_value = table.get("folder") or table.get("name", "untitled_table")
    normalized_folder = dependencies.normalize_folder(str(folder_value))
    table["folder"] = dependencies.sanitize_folder(
        normalized_folder,
        fallback="untitled_table",
    )

    _upsert_table(registry, table, dependencies)
    dependencies.ensure_asset_directories(table, registry)
    dependencies.ensure_table_folder(table, registry)
    dependencies.ensure_table_seeds(table)
    dependencies.ensure_global_status_catalog(registry)
    dependencies.ensure_action_rules(table)
    ensure_main_view(registry, str(table["id"]))
    dependencies.save_registry(registry)
    return table


async def create_table(
    table: RegistryData,
    dependencies: CreateTableDependencies,
) -> RegistryData:
    with dependencies.registry_mutation():
        return create_table_locked(table, dependencies)


def _validate_delete_revisions(
    *,
    table: RegistryData | None,
    registry: RegistryData,
    table_id: str,
    expected_table_revision: str | None,
    expected_views_revision: str | None,
    dependencies: DeleteTableDependencies,
) -> None:
    if expected_table_revision is not None:
        if not table or dependencies.stable_revision(table) != expected_table_revision:
            raise HTTPException(
                status_code=409,
                detail="Table changed after confirmation preview",
            )
    if (
        expected_views_revision is not None
        and dependencies.views_revision(registry, table_id) != expected_views_revision
    ):
        raise HTTPException(
            status_code=409,
            detail="Table views changed after confirmation preview",
        )


def _find_table_database(
    registry: RegistryData,
    table_id: str,
) -> tuple[RegistryData | None, RegistryData | None]:
    table = next(
        (item for item in _registry_items(registry, "tables") if item.get("id") == table_id),
        None,
    )
    if not table:
        return None, None
    database = next(
        (
            item
            for item in _registry_items(registry, "databases")
            if str(item.get("id")) == str(table.get("database_id"))
        ),
        None,
    )
    return table, database


def _quarantine_table_assets(
    table: RegistryData | None,
    database: RegistryData | None,
    expected_revision: str | None,
    dependencies: DeleteTableDependencies,
) -> tuple[Path | None, AssetMoves]:
    if not table:
        return None, []
    quarantine, moved_assets = dependencies.quarantine_assets(table, database)
    if (
        expected_revision is not None
        and dependencies.quarantined_revision(table, database, moved_assets) != expected_revision
    ):
        dependencies.restore_quarantine(quarantine, moved_assets)
        raise HTTPException(
            status_code=409,
            detail="Table assets changed after confirmation preview",
        )
    return quarantine, moved_assets


def _commit_table_deletion(
    registry: RegistryData,
    table_id: str,
    quarantine: Path | None,
    moved_assets: AssetMoves,
    dependencies: DeleteTableDependencies,
) -> Path | None:
    registry["tables"] = [
        item for item in _registry_items(registry, "tables") if item.get("id") != table_id
    ]
    registry["views"] = [
        item for item in _registry_items(registry, "views") if item.get("table_id") != table_id
    ]
    try:
        dependencies.save_registry(registry)
    except Exception:
        dependencies.restore_quarantine(quarantine, moved_assets)
        raise
    if not quarantine:
        return None
    try:
        return dependencies.mark_quarantine_ready(quarantine)
    except Exception:
        dependencies.logger.exception(
            "Table deletion committed but asset quarantine could not be marked ready: %s",
            quarantine,
        )
        return None


async def delete_table(
    table_id: str,
    background_tasks: BackgroundTasks,
    expected_table_revision: str | None,
    expected_views_revision: str | None,
    expected_asset_revision: str | None,
    dependencies: DeleteTableDependencies,
) -> RegistryData:
    vault_root = dependencies.vault_root().resolve()
    quarantine: Path | None = None
    ready_quarantine: Path | None = None
    moved_assets: AssetMoves = []
    with dependencies.registry_mutation():
        registry = dependencies.load_registry()
        table, database = _find_table_database(registry, table_id)
        _validate_delete_revisions(
            table=table,
            registry=registry,
            table_id=table_id,
            expected_table_revision=expected_table_revision,
            expected_views_revision=expected_views_revision,
            dependencies=dependencies,
        )
        quarantine, moved_assets = _quarantine_table_assets(
            table,
            database,
            expected_asset_revision,
            dependencies,
        )
        ready_quarantine = _commit_table_deletion(
            registry,
            table_id,
            quarantine,
            moved_assets,
            dependencies,
        )
    if ready_quarantine:
        background_tasks.add_task(
            dependencies.delete_quarantine,
            ready_quarantine,
            vault_root,
        )
    return {
        "status": "success",
        "cleanup_status": (
            "queued" if ready_quarantine else "deferred" if quarantine else "not_required"
        ),
    }


def _rename_flat_asset_directory(
    *,
    old_name: str,
    new_name: str,
    database_segment: str,
    old_segment: str,
    new_segment: str,
    dependencies: RenameTableDependencies,
) -> bool:
    old_directory = dependencies.assets_root() / old_segment
    new_directory = dependencies.assets_root() / new_segment
    old_collides = dependencies.asset_segments_collide(old_segment, database_segment)
    new_collides = dependencies.asset_segments_collide(new_segment, database_segment)
    if not old_directory.is_dir():
        return False
    if old_collides and new_collides:
        dependencies.logger.info(
            "Flat assets folder coincides with DB root for both names (%s→%s); nothing to move.",
            old_name,
            new_name,
        )
        return False
    if old_collides or new_collides:
        moved = dependencies.move_loose_files(old_directory, new_directory)
        dependencies.logger.info(
            "Collision-safe flat assets move (%s→%s): %s loose file(s) %s → "
            "%s; left DB-nested subfolders in place.",
            old_name,
            new_name,
            moved,
            old_directory,
            new_directory,
        )
        return True
    if not new_directory.exists():
        old_directory.rename(new_directory)
        dependencies.logger.info(
            "Renamed flat assets folder: %s → %s", old_directory, new_directory
        )
        return True
    dependencies.logger.warning(
        "Both old and new flat assets dirs exist for table rename (%s→%s); leaving as-is.",
        old_name,
        new_name,
    )
    return False


def _rename_structured_asset_directory(
    *,
    old_name: str,
    new_name: str,
    database_segment: str,
    old_segment: str,
    new_segment: str,
    dependencies: RenameTableDependencies,
) -> None:
    old_directory = dependencies.assets_root() / database_segment / old_segment
    new_directory = dependencies.assets_root() / database_segment / new_segment
    if old_directory.is_dir() and not new_directory.exists():
        old_directory.rename(new_directory)
        dependencies.logger.info(
            "Renamed structured assets folder: %s → %s",
            old_directory,
            new_directory,
        )
    elif old_directory.is_dir() and new_directory.exists():
        dependencies.logger.warning(
            "Both old and new structured assets dirs exist for table rename "
            "(%s→%s); leaving as-is.",
            old_name,
            new_name,
        )


def _rename_table_assets(
    table: RegistryData,
    registry: RegistryData,
    old_name: str,
    new_name: str,
    dependencies: RenameTableDependencies,
) -> DeferredRewrite:
    database = next(
        (
            item
            for item in _registry_items(registry, "databases")
            if str(item.get("id")) == str(table.get("database_id"))
        ),
        None,
    )
    database_segment = dependencies.sanitize_asset_segment(
        (database or {}).get("name") or table.get("database_id") or "General",
        "General",
    )
    old_segment = dependencies.sanitize_asset_segment(old_name, "Table")
    new_segment = dependencies.sanitize_asset_segment(new_name, "Table")
    should_rewrite = False
    try:
        should_rewrite = _rename_flat_asset_directory(
            old_name=old_name,
            new_name=new_name,
            database_segment=database_segment,
            old_segment=old_segment,
            new_segment=new_segment,
            dependencies=dependencies,
        )
    except Exception as error:
        dependencies.logger.warning("Could not rename flat assets folder: %s", error)
    deferred: DeferredRewrite = None
    if should_rewrite:
        try:
            table_directory = dependencies.table_vault_directory(table, registry)
            if table_directory:
                deferred = table_directory, old_segment, new_segment
        except Exception as error:
            dependencies.logger.warning(
                "Could not resolve table dir for inline ref rewrite: %s", error
            )
    try:
        _rename_structured_asset_directory(
            old_name=old_name,
            new_name=new_name,
            database_segment=database_segment,
            old_segment=old_segment,
            new_segment=new_segment,
            dependencies=dependencies,
        )
    except Exception as error:
        dependencies.logger.warning("Could not rename structured assets folder: %s", error)
    return deferred


def rename_table_locked(
    table_id: str,
    data: RegistryData,
    dependencies: RenameTableDependencies,
) -> DeferredRewrite:
    deferred: DeferredRewrite = None
    registry = dependencies.load_registry()
    for table in _registry_items(registry, "tables"):
        if table["id"] != table_id:
            continue
        old_name = str(table.get("name") or "").strip()
        if "name" in data:
            table["name"] = normalize_table_view_name(data["name"], old_name or "Untitled Table")
            if not table.get("folder"):
                table["folder"] = dependencies.sanitize_title(
                    table["name"], fallback="untitled_table"
                )
        if "folder" in data:
            table["folder"] = dependencies.sanitize_folder(
                data["folder"],
                fallback=str(table.get("folder") or "untitled_table"),
            )
        new_name = str(table.get("name") or "").strip()
        if old_name and new_name and old_name != new_name:
            deferred = _rename_table_assets(table, registry, old_name, new_name, dependencies)
        dependencies.ensure_asset_directories(table, registry)
        dependencies.ensure_table_folder(table, registry)
        break
    normalize_registry_table_view_names(registry)
    dependencies.save_registry(registry)
    return deferred


async def rename_table(
    table_id: str,
    data: RegistryData,
    dependencies: RenameTableDependencies,
) -> RegistryData:
    with dependencies.registry_mutation():
        deferred = rename_table_locked(table_id, data, dependencies)
    if deferred:
        table_directory, old_segment, new_segment = deferred
        try:
            changed = await asyncio.to_thread(
                dependencies.rewrite_inline_asset_refs,
                table_directory,
                old_segment,
                new_segment,
            )
            if changed:
                dependencies.logger.info(
                    "Rewrote inline asset refs in %s page(s) for table rename (%s→%s).",
                    changed,
                    old_segment,
                    new_segment,
                )
        except Exception as error:
            dependencies.logger.warning("Could not rewrite inline asset refs: %s", error)
    return {"status": "success"}


__all__ = [
    "CreateTableDependencies",
    "DeleteTableDependencies",
    "RenameTableDependencies",
    "create_table",
    "create_table_locked",
    "delete_table",
    "rename_table",
    "rename_table_locked",
]
