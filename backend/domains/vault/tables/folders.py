"""Physical Vault-folder lifecycle for tables."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from backend.domains.vault.registry.state import RegistryData


@dataclass(frozen=True)
class TableFolderDependencies:
    """Narrow platform ports supplied by the Vault composition facade."""

    get_path: Callable[[str], Path]
    normalize_folder: Callable[[str | None], str]
    move: Callable[[str, str], object]
    logger: logging.Logger


_dependencies: TableFolderDependencies | None = None


def configure(dependencies: TableFolderDependencies) -> None:
    """Configure the folder service exactly once for one dependency set."""
    global _dependencies
    if _dependencies is not None and _dependencies != dependencies:
        raise RuntimeError("Table folder lifecycle is already configured")
    _dependencies = dependencies


def _deps() -> TableFolderDependencies:
    if _dependencies is None:
        raise RuntimeError("Table folder lifecycle has not been configured")
    return _dependencies


def _database_folder(table: RegistryData, registry: RegistryData) -> str:
    database_id = table.get("database_id")
    for database in registry.get("databases", []) or []:
        if not isinstance(database, dict) or database.get("id") != database_id:
            continue
        normalized = _deps().normalize_folder(database.get("folder"))
        return normalized or f"BD/{database.get('name', 'General')}"
    return "BD"


def _migrate_legacy_root(
    legacy_root: Path,
    target: Path,
    database_folder: str,
    folder: str,
) -> None:
    database_root = _deps().get_path("VAULT") / database_folder
    if not legacy_root.exists() or not legacy_root.is_dir():
        return
    if legacy_root == database_root or target.exists():
        return
    _deps().logger.info(
        "📦 Migrating table folder from ROOT to %s: %s",
        database_folder,
        folder,
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    _deps().move(str(legacy_root), str(target))


def _migrate_legacy_database_root(
    legacy_database: Path,
    target: Path,
    database_folder: str,
    folder: str,
) -> None:
    if not legacy_database.exists() or not legacy_database.is_dir():
        return
    if legacy_database == target:
        return
    if not target.exists():
        _deps().logger.info(
            "📦 Migrating table folder from BD to %s: %s",
            database_folder,
            folder,
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        _deps().move(str(legacy_database), str(target))
        return
    _deps().logger.warning(
        "⚠️ Legacy folder in BD/ still exists for %s. Considering cleanup.",
        folder,
    )
    if not any(legacy_database.iterdir()):
        legacy_database.rmdir()


def _ensure_target(target: Path, database_folder: str) -> None:
    if target.exists():
        return
    target.mkdir(parents=True, exist_ok=True)
    _deps().logger.info("✅ Table folder created at %s/: %s", database_folder, target)


def _ensure_table_vault_folder(
    table: RegistryData,
    registry_data: RegistryData,
) -> None:
    """Create or migrate a table folder below its database directory."""
    folder = _deps().normalize_folder(table.get("folder"))
    if not folder:
        _deps().logger.warning(
            "Table %s (%s) does not have a 'folder' property defined.",
            table.get("id"),
            table.get("name"),
        )
        return

    database_folder = _database_folder(table, registry_data)
    vault_root = _deps().get_path("VAULT")
    target = vault_root / database_folder / folder
    legacy_root = vault_root / folder
    legacy_database = _deps().get_path("DATABASES") / folder
    try:
        _migrate_legacy_root(legacy_root, target, database_folder, folder)
        _migrate_legacy_database_root(
            legacy_database,
            target,
            database_folder,
            folder,
        )
        _ensure_target(target, database_folder)
    except Exception as error:
        _deps().logger.error(
            "❌ Error managing folder for table %s at %s: %s",
            folder,
            database_folder,
            error,
        )


def _table_vault_dir(
    table: RegistryData,
    registry: RegistryData,
) -> Path | None:
    """Return the physical table directory below ``BD/<database>``."""
    folder = _deps().normalize_folder(table.get("folder"))
    if not folder:
        return None
    return _deps().get_path("VAULT") / _database_folder(table, registry) / folder


__all__ = [
    "TableFolderDependencies",
    "_ensure_table_vault_folder",
    "_table_vault_dir",
    "configure",
]
