"""Table row discovery, context resolution and read enrichment."""

from __future__ import annotations

import logging
import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.schemas.pages import PageInfo


@dataclass(frozen=True)
class TableRowQueryDependencies:
    vault_cache_key: Callable[[], str]
    cache_get: Callable[[str], list[PageInfo] | None]
    cache_set: Callable[[str, list[PageInfo]], None]
    cached_entries: Callable[[], list[RegistryData]]
    load_registry: Callable[[], RegistryData]
    hidden_event_ids: Callable[[], set[str]]
    humanize_title: Callable[[object, RegistryData], str]
    table_by_id: Callable[[str], RegistryData | None]
    refresh_metadata: Callable[[list[PageInfo]], None]
    inject_virtual_fields: Callable[
        [RegistryData | None, list[PageInfo], Callable[[str], list[PageInfo]]],
        object,
    ]
    response_names: Callable[[RegistryData, RegistryData], RegistryData]
    vault_root: Callable[[], Path]
    logger: logging.Logger


@dataclass(frozen=True)
class TableMetadataDependencies:
    table_id: Callable[[RegistryData], str | None]
    table_by_id: Callable[[str], RegistryData | None]
    storage_names: Callable[[RegistryData, RegistryData], tuple[RegistryData, object]]
    stamp_system_dates: Callable[..., object]
    option_types: frozenset[str] | set[str]
    prop_config: Callable[[RegistryData], RegistryData]
    read_prop_value: Callable[[RegistryData, RegistryData], object]
    effect_write_key: Callable[[RegistryData, RegistryData], str | None]


def normalize_table_context(metadata: RegistryData) -> RegistryData:
    """Keep canonical and legacy table identifiers synchronized."""
    table_id = metadata.get("table_id")
    database_table_id = metadata.get("database_table_id")
    if str(table_id or "").strip().lower() == "wiki":
        metadata.pop("table_id", None)
        table_id = None
    if str(database_table_id or "").strip().lower() == "wiki":
        metadata.pop("database_table_id", None)
        database_table_id = None
    if table_id and not database_table_id:
        metadata["database_table_id"] = table_id
    elif database_table_id and not table_id:
        metadata["table_id"] = database_table_id
    return metadata


def normalize_relative_folder(folder: str | None) -> str:
    """Normalize host and container paths to a vault-relative folder."""
    if not folder:
        return ""
    normalized = str(folder).replace("\\", "/")
    if "Gnosi/" in normalized:
        normalized = normalized.split("Gnosi/", 1)[1]
    elif normalized.startswith("/vault/"):
        normalized = normalized[7:]
    elif normalized.startswith("/vault"):
        normalized = normalized[6:]
    return normalized.strip().strip("/")


def build_table_folder_index(registry: RegistryData) -> dict[str, str]:
    """Map every canonical table folder prefix to its table ID."""
    database_folders = _database_folder_index(registry)
    output: dict[str, str] = {}
    raw_tables = registry.get("tables", [])
    for table in raw_tables:
        if isinstance(table, dict):
            _add_table_folders(output, table, database_folders)
    return output


def _database_folder_index(registry: RegistryData) -> dict[str, str]:
    raw_databases = registry.get("databases", [])
    databases = [item for item in raw_databases if isinstance(item, dict)]
    return {
        str(database["id"]): normalize_relative_folder(str(database.get("folder") or ""))
        for database in databases
        if database.get("id")
    }


def _add_table_folders(
    output: dict[str, str],
    table: RegistryData,
    database_folders: dict[str, str],
) -> None:
    raw_folder = table.get("folder")
    table_id = str(table.get("id") or "")
    if not raw_folder or not table_id:
        return
    database_id = str(table.get("database_id") or "")
    database_prefix = database_folders.get(database_id, "")
    plain_folder = normalize_relative_folder(str(raw_folder))
    if plain_folder:
        output[plain_folder.lower()] = table_id
    if not database_prefix:
        return
    full_path = normalize_relative_folder(f"{database_prefix}/{raw_folder}")
    if full_path and full_path.lower() != plain_folder.lower():
        output[full_path.lower()] = table_id


def resolve_table_id_from_context(
    metadata: RegistryData,
    relative_folder: str,
    folder_to_table: dict[str, str],
    sorted_folders: list[str] | None = None,
) -> str | None:
    """Resolve table ownership from folder prefixes, then legacy metadata."""
    folder_key = normalize_relative_folder(relative_folder).lower()
    if folder_key:
        folders = sorted_folders or sorted(folder_to_table.keys(), key=len, reverse=True)
        for folder in folders:
            if folder_key == folder or folder_key.startswith(folder + "/"):
                return folder_to_table[folder]
    result = metadata.get("table_id") or metadata.get("database_table_id")
    if str(result or "").strip().lower() == "wiki":
        return None
    return str(result) if result else None


def resolve_table_folder_from_metadata(
    metadata: RegistryData,
    dependencies: TableRowQueryDependencies,
) -> Path | None:
    """Resolve the physical table directory for one page's metadata."""
    table_id = metadata.get("table_id") or metadata.get("database_table_id")
    if not table_id:
        return None
    registry = dependencies.load_registry()
    raw_tables = registry.get("tables", [])
    table = next(
        (item for item in raw_tables if isinstance(item, dict) and item.get("id") == table_id),
        None,
    )
    if not table:
        return None
    folder = normalize_relative_folder(str(table.get("folder") or ""))
    if not folder:
        return None
    database_id = table.get("database_id")
    database_folder = "BD"
    raw_databases = registry.get("databases", [])
    for database in raw_databases:
        if not isinstance(database, dict) or database.get("id") != database_id:
            continue
        database_folder = (
            normalize_relative_folder(str(database.get("folder") or ""))
            or f"BD/{database.get('name', 'General')}"
        )
        break
    return dependencies.vault_root() / database_folder / folder


def resolve_page_context_from_path(
    metadata: RegistryData,
    file_path: Path,
    dependencies: TableRowQueryDependencies,
) -> tuple[str, str | None]:
    """Return vault-relative folder and resolved table ID for one page."""
    relative_folder = str(file_path.parent.relative_to(dependencies.vault_root())).replace(
        "\\", "/"
    )
    if relative_folder == ".":
        relative_folder = ""
    folder_to_table = build_table_folder_index(dependencies.load_registry())
    return relative_folder, resolve_table_id_from_context(
        metadata,
        relative_folder,
        folder_to_table,
    )


def _normalize_resource_title(value: str) -> str:
    normalized = unicodedata.normalize("NFD", str(value or ""))
    normalized = "".join(
        character for character in normalized if unicodedata.category(character) != "Mn"
    )
    normalized = normalized.lower()
    return re.sub(r"[^a-z0-9]+", " ", normalized).strip()


def _resource_visible_record(page: PageInfo) -> bool:
    metadata = page.metadata or {}
    if metadata.get("is_template"):
        return False
    resource_type = ""
    for key, value in metadata.items():
        normalized_key = str(key).strip().lower().replace("_", "").replace(" ", "")
        if normalized_key in ("type", "tipus", "tipo"):
            resource_type = str(value or "").strip().lower()
            break
    title = str(page.title or "").strip().lower()
    page_id = str(metadata.get("id") or page.id or "").strip()
    return not (
        resource_type == "annotation"
        or title in {"new", "untitled", "sense títol", "sense titol"}
        or not page_id
    )


def canonical_visible_table_pages(
    table_id: str,
    pages: list[PageInfo],
) -> list[PageInfo]:
    """Apply the canonical visibility and resource deduplication rules."""
    filtered = [page for page in pages if not page.metadata.get("is_template")]
    if table_id != "resources":
        return filtered
    deduplicated: dict[str, PageInfo] = {}
    for page in (item for item in filtered if _resource_visible_record(item)):
        key = _normalize_resource_title(page.title) or f"__{page.id}"
        existing = deduplicated.get(key)
        if existing is None:
            deduplicated[key] = page
            continue
        try:
            existing_timestamp = datetime.fromisoformat(existing.last_modified).timestamp()
        except Exception:
            existing_timestamp = 0
        try:
            next_timestamp = datetime.fromisoformat(page.last_modified).timestamp()
        except Exception:
            next_timestamp = 0
        if next_timestamp > existing_timestamp:
            deduplicated[key] = page
    return list(deduplicated.values())


def _matches_table(
    entry: RegistryData,
    table_id: str,
    folder_to_table: dict[str, str],
    all_prefixes: list[str],
) -> bool:
    folder_key = normalize_relative_folder(str(entry.get("folder") or "")).lower()
    belongs = False
    resolved_elsewhere = False
    if folder_key:
        for folder in all_prefixes:
            if folder_key == folder or folder_key.startswith(folder + "/"):
                belongs = folder_to_table[folder] == table_id
                resolved_elsewhere = not belongs
                break
    if not belongs and not resolved_elsewhere:
        raw_metadata = entry.get("metadata") or {}
        metadata = raw_metadata if isinstance(raw_metadata, dict) else {}
        metadata_table_id = metadata.get("table_id") or metadata.get("database_table_id")
        belongs = metadata_table_id == table_id and str(metadata_table_id).strip().lower() != "wiki"
    return belongs


def _page_from_entry(
    entry: RegistryData,
    table_id: str,
    dependencies: TableRowQueryDependencies,
) -> PageInfo:
    raw_metadata = entry.get("metadata") or {}
    metadata = raw_metadata if isinstance(raw_metadata, dict) else {}
    modified = float(entry["mtime"])
    created = float(entry.get("created_mtime") or modified)
    return PageInfo.model_construct(
        id=str(entry["id"]),
        title=dependencies.humanize_title(entry["title"], metadata),
        parent_id=entry.get("parent_id"),
        is_database=bool(entry.get("is_database", False)),
        metadata=metadata,
        last_modified=datetime.fromtimestamp(modified).isoformat(),
        created_time=datetime.fromtimestamp(created).isoformat(),
        size=int(entry["size"]),
        folder=str(entry.get("folder") or ""),
        path=entry.get("path"),
        resolved_table_id=table_id,
    )


def get_pages_for_table(
    table_id: str,
    dependencies: TableRowQueryDependencies,
) -> list[PageInfo]:
    """Build PageInfo only for cached entries belonging to one table."""
    cache_key = f"by-table:{dependencies.vault_cache_key()}:{table_id}"
    cached = dependencies.cache_get(cache_key)
    if cached is not None:
        return cached
    raw_entries = dependencies.cached_entries()
    if not raw_entries:
        return []
    folder_to_table = build_table_folder_index(dependencies.load_registry())
    all_prefixes = sorted(folder_to_table.keys(), key=len, reverse=True)
    hidden_ids = dependencies.hidden_event_ids()
    matching = [
        entry
        for entry in raw_entries
        if str(entry["id"]) not in hidden_ids
        and _matches_table(entry, table_id, folder_to_table, all_prefixes)
    ]
    pages_by_id: dict[str, PageInfo] = {}
    duplicate_ids: set[str] = set()
    for entry in matching:
        page = _page_from_entry(entry, table_id, dependencies)
        existing = pages_by_id.get(page.id)
        if existing is None:
            pages_by_id[page.id] = page
        else:
            duplicate_ids.add(page.id)
            if page.last_modified > existing.last_modified:
                pages_by_id[page.id] = page
    if duplicate_ids:
        dependencies.logger.debug(
            "Deduplicated %s pages with repeated ID in table %s",
            len(duplicate_ids),
            table_id,
        )
    pages = list(pages_by_id.values())
    pages.sort(key=lambda page: page.last_modified, reverse=True)
    dependencies.cache_set(cache_key, pages)
    return pages


def enrich_table_query_pages(
    table_id: str,
    pages: list[PageInfo],
    dependencies: TableRowQueryDependencies,
) -> None:
    """Hydrate metadata, virtual fields and response-facing property names."""
    dependencies.refresh_metadata(pages)
    table = dependencies.table_by_id(table_id)
    dependencies.inject_virtual_fields(
        table,
        pages,
        lambda requested_table_id: virtual_page_loader(requested_table_id, dependencies),
    )
    if table:
        for page in pages:
            page.metadata = dependencies.response_names(page.metadata or {}, table)


def virtual_page_loader(
    table_id: str,
    dependencies: TableRowQueryDependencies,
) -> list[PageInfo]:
    """Load canonical rows for virtual-field inverse computations."""
    pages = get_pages_for_table(table_id, dependencies)
    try:
        dependencies.refresh_metadata(pages)
    except Exception as error:
        dependencies.logger.debug("_vf_page_loader refresh skipped for %s: %s", table_id, error)
    table = dependencies.table_by_id(table_id)
    if table:
        for page in pages:
            try:
                page.metadata = dependencies.response_names(page.metadata or {}, table)
            except Exception:
                pass
    return pages


def prepare_create_table_metadata(
    metadata: RegistryData,
    dependencies: TableMetadataDependencies,
) -> tuple[RegistryData, RegistryData | None]:
    """Normalize a new row and apply schema-defined default options."""
    table_id = dependencies.table_id(metadata)
    table = dependencies.table_by_id(table_id) if table_id else None
    if not table:
        return metadata, None
    metadata, _ = dependencies.storage_names(metadata, table)
    dependencies.stamp_system_dates(metadata, table, is_create=True)
    raw_properties = table.get("properties") or []
    for prop in raw_properties:
        if not isinstance(prop, dict) or prop.get("type") not in dependencies.option_types:
            continue
        default = str(dependencies.prop_config(prop).get("default_option") or "").strip()
        if not default or dependencies.read_prop_value(metadata, prop) not in (
            None,
            "",
            [],
        ):
            continue
        key = dependencies.effect_write_key(metadata, prop)
        if key:
            metadata[key] = [default] if prop.get("type") == "multi_select" else default
    return metadata, table


__all__ = [
    "TableMetadataDependencies",
    "TableRowQueryDependencies",
    "build_table_folder_index",
    "canonical_visible_table_pages",
    "enrich_table_query_pages",
    "get_pages_for_table",
    "normalize_relative_folder",
    "normalize_table_context",
    "prepare_create_table_metadata",
    "resolve_page_context_from_path",
    "resolve_table_folder_from_metadata",
    "resolve_table_id_from_context",
    "virtual_page_loader",
]
