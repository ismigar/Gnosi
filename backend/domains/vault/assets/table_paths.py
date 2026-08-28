"""Table-scoped asset path and directory lifecycle."""

from __future__ import annotations

import logging
import shutil
import urllib.parse
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from backend.domains.vault.registry.state import RegistryData


class AssetSegmentSanitizer(Protocol):
    def __call__(self, value: object, fallback: str) -> str: ...


@dataclass(frozen=True)
class TableAssetPathDependencies:
    """Narrow filesystem and compatibility ports for table asset paths."""

    get_path: Callable[[str], Path]
    sanitize_segment: AssetSegmentSanitizer
    is_asset_property: Callable[[RegistryData], bool]
    property_assets_dir: Callable[[RegistryData, RegistryData | None, str], Path]
    table_assets_dir: Callable[[RegistryData, RegistryData | None], Path]
    table_asset_paths: Callable[[RegistryData, RegistryData | None], list[Path]]
    segments_collide: Callable[[object, object], bool]
    revision: Callable[[Iterable[tuple[str, Path]]], str]
    write_text: Callable[[Path, str], None]
    logger: logging.Logger


_dependencies: TableAssetPathDependencies | None = None


def configure(dependencies: TableAssetPathDependencies) -> None:
    """Configure the path service exactly once for one dependency set."""
    global _dependencies
    if _dependencies is not None and _dependencies != dependencies:
        raise RuntimeError("Table asset paths are already configured")
    _dependencies = dependencies


def _deps() -> TableAssetPathDependencies:
    if _dependencies is None:
        raise RuntimeError("Table asset paths have not been configured")
    return _dependencies


def _registry_items(registry: RegistryData, key: str) -> list[RegistryData]:
    raw_items = registry.get(key, [])
    return [item for item in raw_items if isinstance(item, dict)]


def _resolve_table_and_database_for_assets(
    table_id: str,
    registry: RegistryData,
) -> tuple[RegistryData | None, RegistryData | None]:
    table = next(
        (
            item
            for item in _registry_items(registry, "tables")
            if str(item.get("id")) == str(table_id)
        ),
        None,
    )
    if not table:
        return None, None
    database_id = table.get("database_id")
    database = next(
        (
            item
            for item in _registry_items(registry, "databases")
            if str(item.get("id")) == str(database_id)
        ),
        None,
    )
    return table, database


def _property_assets_dir(
    table: RegistryData,
    database: RegistryData | None,
    property_name: str,
) -> Path:
    db_segment = _deps().sanitize_segment(
        (database or {}).get("name") or (table or {}).get("database_id") or "General",
        "General",
    )
    table_segment = _deps().sanitize_segment(
        (table or {}).get("name") or (table or {}).get("id") or "Table",
        "Table",
    )
    property_segment = _deps().sanitize_segment(property_name, "Property")
    return _deps().get_path("ASSETS") / db_segment / table_segment / property_segment


def _find_table_property(
    table: RegistryData | None,
    property_name: str,
) -> RegistryData | None:
    """Return a property matched by its name or one historical alias."""
    name = str(property_name or "").strip()
    if not table or not name:
        return None
    for prop in _registry_items(table, "properties"):
        if str(prop.get("name") or "").strip() == name:
            return prop
        if name in (prop.get("aliases") or []):
            return prop
    return None


def _property_config_value(prop: RegistryData | None, key: str) -> object | None:
    """Read a flat property setting or its nested ``config`` fallback."""
    if not prop:
        return None
    value: object = prop.get(key)
    if value is not None:
        return value
    config: object = prop.get("config")
    if isinstance(config, dict):
        nested: object = config.get(key)
        return nested
    return None


def _database_for_table(
    table: RegistryData,
    registry: RegistryData,
) -> RegistryData | None:
    database_id = table.get("database_id")
    return next(
        (
            item
            for item in _registry_items(registry, "databases")
            if str(item.get("id")) == str(database_id)
        ),
        None,
    )


def _ensure_flat_asset_directory(table: RegistryData) -> None:
    table_name = str(table.get("name") or "").strip()
    if not table_name:
        return
    try:
        segment = _deps().sanitize_segment(table_name, "Table")
        (_deps().get_path("ASSETS") / segment).mkdir(parents=True, exist_ok=True)
    except Exception as error:
        _deps().logger.warning("Could not create Assets/%s/: %s", table_name, error)


def _ensure_property_asset_directories(
    table: RegistryData,
    database: RegistryData | None,
) -> None:
    for prop in _registry_items(table, "properties"):
        if not _deps().is_asset_property(prop):
            continue
        property_name = str(prop.get("name") or "").strip()
        if not property_name:
            continue
        _deps().property_assets_dir(table, database, property_name).mkdir(
            parents=True,
            exist_ok=True,
        )


def _ensure_asset_dirs_for_table_entry(
    table: RegistryData,
    registry: RegistryData,
) -> None:
    """Create the flat and per-property asset folders for one table."""
    if not table:
        return
    database = _database_for_table(table, registry)
    _ensure_flat_asset_directory(table)
    _ensure_property_asset_directories(table, database)


def _table_assets_dir(
    table: RegistryData,
    database: RegistryData | None,
) -> Path:
    """Return the structured ``Assets/<database>/<table>`` directory."""
    database_segment = _deps().sanitize_segment(
        (database or {}).get("name") or (table or {}).get("database_id") or "General",
        "General",
    )
    table_segment = _deps().sanitize_segment(
        (table or {}).get("name") or (table or {}).get("id") or "Table",
        "Table",
    )
    return _deps().get_path("ASSETS") / database_segment / table_segment


def _candidate_asset_paths(
    table: RegistryData,
    database: RegistryData | None,
) -> list[Path]:
    paths = [_deps().table_assets_dir(table, database)]
    table_name = str((table or {}).get("name") or "").strip()
    if not table_name:
        return paths
    table_segment = _deps().sanitize_segment(table_name, "Table")
    database_segment = _deps().sanitize_segment(
        (database or {}).get("name") or (table or {}).get("database_id") or "General",
        "General",
    )
    flat_path = _deps().get_path("ASSETS") / table_segment
    if not _deps().segments_collide(table_segment, database_segment):
        paths.append(flat_path)
        return paths
    if flat_path.is_dir() and not flat_path.is_symlink():
        paths.extend(
            entry for entry in flat_path.iterdir() if not entry.is_dir() or entry.is_symlink()
        )
    return paths


def _contained_unique_paths(candidates: Iterable[Path]) -> list[Path]:
    assets_root = _deps().get_path("ASSETS").resolve()
    unique: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        resolved = candidate.parent.resolve() / candidate.name
        try:
            resolved.relative_to(assets_root)
        except ValueError:
            _deps().logger.warning("Unsafe table asset path ignored: %s", candidate)
            continue
        key = str(resolved)
        if key in seen:
            continue
        seen.add(key)
        unique.append(resolved)
    return unique


def _minimal_asset_paths(paths: Iterable[Path]) -> list[Path]:
    minimal: list[Path] = []
    for candidate in sorted(paths, key=lambda path: len(path.parts)):
        if any(candidate == parent or parent in candidate.parents for parent in minimal):
            continue
        minimal.append(candidate)
    return minimal


def _table_asset_paths(
    table: RegistryData,
    database: RegistryData | None,
) -> list[Path]:
    """Return each contained active asset tree owned by one table."""
    candidates = _candidate_asset_paths(table, database)
    return _minimal_asset_paths(_contained_unique_paths(candidates))


def _table_asset_revision(
    table: RegistryData,
    database: RegistryData | None,
) -> str:
    assets_root = _deps().get_path("ASSETS").resolve()
    return _deps().revision(
        (
            (path.relative_to(assets_root).as_posix(), path)
            for path in _deps().table_asset_paths(table, database)
        )
    )


def _delete_asset_property_dir(
    table: RegistryData,
    database: RegistryData | None,
    prop_name: str,
) -> None:
    """Remove an empty property folder while preserving all user files."""
    property_dir = _deps().property_assets_dir(table, database, prop_name)
    if not property_dir.is_dir():
        return
    try:
        if next(property_dir.iterdir(), None) is not None:
            _deps().logger.warning(
                "Preserving non-empty property asset folder after schema removal: %s",
                property_dir,
            )
            return
        property_dir.rmdir()
        _deps().logger.info("Empty property folder deleted: %s", property_dir)
    except Exception as error:
        _deps().logger.warning("Could not delete folder %s: %s", property_dir, error)


def _delete_asset_table_dir(
    table: RegistryData,
    database: RegistryData | None,
) -> None:
    """Recursively remove every table-owned active asset tree."""
    for table_dir in _deps().table_asset_paths(table, database):
        if not table_dir.exists() and not table_dir.is_symlink():
            continue
        try:
            if table_dir.is_dir() and not table_dir.is_symlink():
                shutil.rmtree(table_dir)
            else:
                table_dir.unlink()
            _deps().logger.info("Table asset entry deleted: %s", table_dir)
        except Exception as error:
            _deps().logger.warning(
                "Could not delete table asset entry %s: %s",
                table_dir,
                error,
            )


def _asset_segments_collide(first: object, second: object) -> bool:
    """Return whether two segments share one case-insensitive directory."""
    return str(first or "").strip().casefold() == str(second or "").strip().casefold()


def _move_loose_files(source_dir: Path, destination_dir: Path) -> int:
    """Move loose files while preserving all nested table asset trees."""
    moved = 0
    destination_dir.mkdir(parents=True, exist_ok=True)
    for entry in source_dir.iterdir():
        if not entry.is_file():
            continue
        destination = destination_dir / entry.name
        if destination.exists():
            _deps().logger.warning(
                "Loose asset move skipped, destination exists: %s",
                destination,
            )
            continue
        try:
            entry.rename(destination)
            moved += 1
        except Exception as error:
            _deps().logger.warning(
                "Could not move loose asset %s → %s: %s",
                entry,
                destination,
                error,
            )
    return moved


def _rewritten_asset_text(text: str, old_urls: set[str], new_url: str) -> str:
    rewritten = text
    for old_url in old_urls:
        if old_url in rewritten:
            rewritten = rewritten.replace(old_url, new_url)
    return rewritten


def _rewrite_asset_file(path: Path, old_urls: set[str], new_url: str) -> bool:
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        return False
    rewritten = _rewritten_asset_text(text, old_urls, new_url)
    if rewritten == text:
        return False
    try:
        _deps().write_text(path, rewritten)
    except Exception as error:
        _deps().logger.warning("Could not rewrite asset refs in %s: %s", path, error)
        return False
    return True


def _rewrite_inline_asset_refs(
    pages_dir: Path,
    old_segment: str,
    new_segment: str,
) -> int:
    """Rewrite raw and URL-encoded references after a flat-folder rename."""
    if not pages_dir or not pages_dir.is_dir() or old_segment == new_segment:
        return 0
    new_url = f"/api/vault/assets/{urllib.parse.quote(new_segment)}/"
    old_urls = {
        f"/api/vault/assets/{old_segment}/",
        f"/api/vault/assets/{urllib.parse.quote(old_segment)}/",
    }
    old_urls.discard(new_url)
    if not old_urls:
        return 0
    return sum(_rewrite_asset_file(path, old_urls, new_url) for path in pages_dir.rglob("*.md"))


__all__ = [
    "TableAssetPathDependencies",
    "_asset_segments_collide",
    "_delete_asset_property_dir",
    "_delete_asset_table_dir",
    "_ensure_asset_dirs_for_table_entry",
    "_find_table_property",
    "_move_loose_files",
    "_property_assets_dir",
    "_property_config_value",
    "_resolve_table_and_database_for_assets",
    "_rewrite_inline_asset_refs",
    "_table_asset_paths",
    "_table_asset_revision",
    "_table_assets_dir",
    "configure",
]
