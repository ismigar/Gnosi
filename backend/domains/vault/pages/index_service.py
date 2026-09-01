"""Vault page-index discovery, refresh and snapshot services."""

from __future__ import annotations

import logging
import os
import time
from _thread import LockType
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from fastapi import BackgroundTasks

from backend.domains.vault.pages.index_entries import PageCacheEntry as PageCacheEntry
from backend.domains.vault.registry.records import is_object_list, is_record
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.schemas.pages import PageInfo
from backend.utils.open_values import float_value, integer_value


Metadata = RegistryData

SKIP_DIRECTORIES = frozenset({"assets", "drawings", "mail", ".history", ".trash"})
ALLOWED_HIDDEN_DIRECTORIES = frozenset({".dashboards"})
EXCLUDED_RELATIVE_DIRECTORIES = frozenset({"Calendar/External"})
SIDEBAR_FOLDER_PREFIXES = ("Wiki", ".Dashboards")


@dataclass(frozen=True)
class PageIndexDependencies:
    """Ports and shared state required by the page index."""

    active_vault_path: Callable[[], Path | None]
    get_path: Callable[[str], Path]
    load_from_disk: Callable[[str], bool]
    save_to_disk: Callable[[str], None]
    build_entry: Callable[[Path, os.stat_result], PageCacheEntry]
    build_entry_from_memory: Callable[[Path, os.stat_result, Metadata, str], PageCacheEntry]
    is_metadata_stub: Callable[[Metadata], bool]
    vault_cache_key: Callable[[], str]
    cache_get: Callable[[str], list[PageInfo] | None]
    cache_set: Callable[[str, list[PageInfo]], None]
    load_registry: Callable[[], RegistryData]
    table_vault_dir: Callable[[RegistryData, RegistryData], Path | None]
    build_table_folder_index: Callable[[RegistryData], dict[str, str]]
    resolve_table_id: Callable[[Metadata, str, dict[str, str], list[str] | None], str | None]
    enabled_calendar_tables: Callable[[], list[str]]
    hidden_event_ids: Callable[[], set[str]]
    sync_calendars: Callable[[], object]
    update_path_resolver: Callable[[Path, dict[object, str], list[Path]], None]
    get_last_vault_sync: Callable[[], float]
    set_last_vault_sync: Callable[[float], None]
    index_lock: LockType
    index_entries: dict[str, dict[str, PageCacheEntry]]
    index_initialized: dict[str, bool]
    id_to_path: dict[str, dict[object, str]]
    index_version: dict[str, int]
    body_cache_lock: LockType
    body_cache: dict[str, tuple[int, str]]
    last_stale_check: dict[str, float]
    vault_sync_cooldown_seconds: float
    calendar_sync_cooldown_seconds: float
    stale_check_ttl: float
    logger: logging.Logger


_dependencies: PageIndexDependencies | None = None
_last_calendar_sync_time = 0.0


def configure(dependencies: PageIndexDependencies) -> None:
    """Bind the index ports from the application composition root."""
    global _dependencies
    if _dependencies is not None and _dependencies != dependencies:
        raise RuntimeError("Page index service is already configured")
    _dependencies = dependencies


def _deps() -> PageIndexDependencies:
    if _dependencies is None:
        raise RuntimeError("Page index service has not been configured")
    return _dependencies


def bump_page_index_version(vault_key: str) -> None:
    """Mark one vault index as changed while its index lock is held."""
    dependencies = _deps()
    dependencies.index_version[vault_key] = dependencies.index_version.get(vault_key, 0) + 1


def refresh_page_index_entry(
    file_path: Path,
    metadata: Metadata,
    body: str,
) -> None:
    """Refresh the in-memory index immediately after a page write."""
    dependencies = _deps()
    try:
        vault_path = dependencies.active_vault_path()
        if not vault_path:
            return
        vault_key = str(vault_path)
        new_entry = dependencies.build_entry_from_memory(
            file_path,
            file_path.stat(),
            metadata,
            body or "",
        )
        with dependencies.index_lock:
            dependencies.index_entries.setdefault(vault_key, {})[str(file_path)] = new_entry
            entry_id = new_entry.get("id") or metadata.get("id")
            if entry_id:
                dependencies.id_to_path.setdefault(vault_key, {})[str(entry_id)] = str(file_path)
            bump_page_index_version(vault_key)
        with dependencies.body_cache_lock:
            dependencies.body_cache.pop(str(file_path), None)
    except Exception as error:
        dependencies.logger.debug("refresh index entry failed for %s: %s", file_path, error)


def _read_refresh_target(
    target: tuple[PageInfo, Path],
) -> tuple[PageInfo, Path, PageCacheEntry | None]:
    page, file_path = target
    dependencies = _deps()
    try:
        return page, file_path, dependencies.build_entry(file_path, file_path.stat())
    except Exception as error:
        dependencies.logger.debug("refresh read fail %s: %s", file_path.name, error)
        return page, file_path, None


def refresh_table_pages_metadata(pages: list[PageInfo]) -> None:
    """Hydrate metadata stubs concurrently and update their cached entries."""
    dependencies = _deps()
    vault_path = dependencies.active_vault_path()
    if not vault_path:
        return
    vault_key = str(vault_path)
    targets = [
        (page, Path(page.path))
        for page in pages
        if dependencies.is_metadata_stub(page.metadata or {})
        and page.path
        and Path(page.path).exists()
    ]
    if not targets:
        return

    with ThreadPoolExecutor(max_workers=min(16, len(targets))) as executor:
        results = list(executor.map(_read_refresh_target, targets))

    for page, file_path, entry in results:
        if entry is None or entry.pop("_parse_failed", False):
            continue
        raw_metadata = entry.get("metadata")
        metadata = raw_metadata if is_record(raw_metadata) else {}
        if dependencies.is_metadata_stub(metadata):
            continue
        page.metadata = metadata
        if entry.get("title"):
            page.title = str(entry["title"])
        with dependencies.index_lock:
            cached = dependencies.index_entries.setdefault(vault_key, {}).get(str(file_path))
            if cached is not None:
                cached.update(entry)
                bump_page_index_version(vault_key)


def _filter_by_search_paths(
    entries: Iterable[PageCacheEntry],
    search_paths: list[Path] | None,
) -> list[PageCacheEntry]:
    if not search_paths:
        return list(entries)
    prefixes = [str(path) for path in search_paths]
    return [
        entry
        for entry in entries
        if any(str(entry.get("path") or "").startswith(prefix) for prefix in prefixes)
    ]


def _normalized_sync_name(value: str) -> str:
    return value.lower().replace("_", "").replace(".", "")


def _is_redundant_directory(parts: tuple[str, ...]) -> bool:
    if len(parts) < 2:
        return False
    parent = _normalized_sync_name(parts[-2])
    current = _normalized_sync_name(parts[-1])
    return parent == current and len(parent) > 3


def _is_redundant_file_path(parts: tuple[str, ...]) -> bool:
    if len(parts) < 3 or "calendar" in {part.lower() for part in parts}:
        return False
    directory_parts = parts[:-1]
    return any(
        _normalized_sync_name(parent) == _normalized_sync_name(current)
        and len(_normalized_sync_name(parent)) > 3
        for parent, current in zip(directory_parts, directory_parts[1:])
    )


def _discover_candidate_files(
    vault_path: Path,
    search_paths: list[Path] | None,
) -> list[Path]:
    dependencies = _deps()
    dashboard_path = dependencies.get_path("DASHBOARDS")
    candidates: list[Path] = []
    for root in search_paths or [vault_path]:
        if not root.exists():
            continue
        for directory, directory_names, file_names in os.walk(root):
            relative_directory = Path(directory).relative_to(vault_path)
            directory_names[:] = [
                name
                for name in directory_names
                if (not name.startswith(".") or name.lower() in ALLOWED_HIDDEN_DIRECTORIES)
                and name.lower() not in SKIP_DIRECTORIES
                and (relative_directory / name).as_posix() not in EXCLUDED_RELATIVE_DIRECTORIES
            ]
            if _is_redundant_directory(relative_directory.parts):
                directory_names[:] = []
                continue
            for file_name in file_names:
                file_path = Path(directory) / file_name
                if file_name.startswith("."):
                    continue
                if file_name.endswith(".md"):
                    candidates.append(file_path)
                elif file_name.endswith(".json") and str(directory).startswith(str(dashboard_path)):
                    candidates.append(file_path)
    dependencies.logger.info("Indexer found %d candidate files.", len(candidates))
    return candidates


def _is_indexable_candidate(file_path: Path, vault_path: Path) -> bool:
    try:
        parts = file_path.relative_to(vault_path).parts
    except ValueError:
        return False
    if any(
        part.startswith(".") and part.lower() not in ALLOWED_HIDDEN_DIRECTORIES for part in parts
    ):
        return False
    return not _is_redundant_file_path(parts)


def _unchanged_entry(
    cached: PageCacheEntry | None,
    stat_result: os.stat_result,
) -> bool:
    return bool(
        cached
        and cached.get("mtime_ns") == stat_result.st_mtime_ns
        and cached.get("size") == stat_result.st_size
    )


def _updated_entries(
    candidate_files: list[Path],
    vault_path: Path,
    cached_snapshot: dict[str, PageCacheEntry],
) -> dict[str, PageCacheEntry]:
    dependencies = _deps()
    updated: dict[str, PageCacheEntry] = {}
    for file_path in candidate_files:
        if not _is_indexable_candidate(file_path, vault_path):
            continue
        path_key = str(file_path)
        try:
            stat_result = file_path.stat()
        except (FileNotFoundError, PermissionError):
            continue
        cached = cached_snapshot.get(path_key)
        if _unchanged_entry(cached, stat_result):
            if cached is not None:
                updated[path_key] = cached
            continue
        built = dependencies.build_entry(file_path, stat_result)
        parse_failed = bool(built.pop("_parse_failed", False))
        cached_metadata = cached.get("metadata") if cached else None
        cached_metadata = cached_metadata if is_record(cached_metadata) else {}
        if parse_failed and cached and not dependencies.is_metadata_stub(cached_metadata):
            updated[path_key] = cached
        else:
            updated[path_key] = built
    return updated


def _entry_mtime(entry: PageCacheEntry) -> float:
    raw_value = entry.get("mtime", 0)
    return float(raw_value) if isinstance(raw_value, (int, float)) else 0.0


def _reverse_id_map(entries: dict[str, PageCacheEntry]) -> dict[object, str]:
    result: dict[object, str] = {}
    for path_key, entry in entries.items():
        raw_page_id = entry.get("id")
        if not raw_page_id:
            continue
        page_id = str(raw_page_id)
        existing_path = result.get(page_id)
        if existing_path is None or _entry_mtime(entry) > _entry_mtime(
            entries.get(existing_path, {})
        ):
            result[page_id] = path_key
    return result


def _merge_index(
    vault_path: Path,
    updated: dict[str, PageCacheEntry],
    search_paths: list[Path] | None,
) -> None:
    dependencies = _deps()
    vault_key = str(vault_path)
    with dependencies.index_lock:
        if not search_paths:
            dependencies.index_entries[vault_key] = updated
            id_map = _reverse_id_map(updated)
            dependencies.id_to_path[vault_key] = id_map
            dependencies.update_path_resolver(
                vault_path,
                id_map,
                [Path(path) for path in updated],
            )
        else:
            entries = dependencies.index_entries.setdefault(vault_key, {})
            entries.update(updated)
            id_map = dependencies.id_to_path.setdefault(vault_key, {})
            id_map.update(
                {str(entry["id"]): path for path, entry in updated.items() if entry.get("id")}
            )
            dependencies.update_path_resolver(
                vault_path,
                id_map,
                [Path(path) for path in entries],
            )
        dependencies.index_initialized[vault_key] = True
        bump_page_index_version(vault_key)


def get_cached_page_entries(
    search_paths: list[Path] | None = None,
    force_refresh: bool = False,
) -> list[PageCacheEntry]:
    """Return cached entries, refreshing the requested vault scope when needed."""
    dependencies = _deps()
    vault_path = dependencies.active_vault_path()
    if not vault_path or not vault_path.exists():
        return []
    vault_key = str(vault_path)
    if not dependencies.index_initialized.get(vault_key):
        if not dependencies.load_from_disk(vault_key):
            with dependencies.index_lock:
                dependencies.index_entries.setdefault(vault_key, {})
            dependencies.index_initialized[vault_key] = True
            force_refresh = True
    if not force_refresh:
        with dependencies.index_lock:
            return _filter_by_search_paths(
                dependencies.index_entries.get(vault_key, {}).values(),
                search_paths,
            )

    candidates = _discover_candidate_files(vault_path, search_paths)
    with dependencies.index_lock:
        cached_snapshot = dict(dependencies.index_entries.setdefault(vault_key, {}))
    updated = _updated_entries(candidates, vault_path, cached_snapshot)
    _merge_index(vault_path, updated, search_paths)
    dependencies.save_to_disk(vault_key)
    return _filter_by_search_paths(updated.values(), search_paths)


def _calendar_scope(
    only_calendar: bool,
    registry: RegistryData,
) -> tuple[list[Path] | None, set[str]]:
    if not only_calendar:
        return None, set()
    dependencies = _deps()
    enabled_tables = set(dependencies.enabled_calendar_tables())
    search_paths = [dependencies.get_path("CALENDAR")]
    raw_tables = registry.get("tables", [])
    tables = raw_tables if is_object_list(raw_tables) else []
    for raw_table in tables:
        if not is_record(raw_table) or raw_table.get("id") not in enabled_tables:
            continue
        table_directory = dependencies.table_vault_dir(raw_table, registry)
        if table_directory:
            search_paths.append(table_directory)
    return search_paths, enabled_tables


def _schedule_background_syncs(
    background_tasks: BackgroundTasks | None,
    only_calendar: bool,
    search_paths: list[Path] | None,
) -> None:
    global _last_calendar_sync_time
    if background_tasks is None:
        return
    dependencies = _deps()
    now = time.monotonic()
    if now - dependencies.get_last_vault_sync() > dependencies.vault_sync_cooldown_seconds:
        dependencies.set_last_vault_sync(now)
        background_tasks.add_task(get_cached_page_entries, search_paths, True)
        dependencies.logger.info("Background sync triggered for page index.")
    if (
        only_calendar
        and now - _last_calendar_sync_time > dependencies.calendar_sync_cooldown_seconds
    ):
        _last_calendar_sync_time = now
        background_tasks.add_task(dependencies.sync_calendars)
        dependencies.logger.info("Background calendar sync triggered.")


def _remove_stale_entries(stale_paths: list[str]) -> None:
    if not stale_paths:
        return
    dependencies = _deps()
    vault_path = dependencies.active_vault_path()
    if not vault_path:
        return
    vault_key = str(vault_path)
    pruned = False
    with dependencies.index_lock:
        entries = dependencies.index_entries.get(vault_key, {})
        id_map = dependencies.id_to_path.get(vault_key, {})
        for path_key in stale_paths:
            entry = entries.pop(path_key, None)
            if entry:
                id_map.pop(str(entry.get("id") or ""), None)
                pruned = True
        if pruned:
            bump_page_index_version(vault_key)
    if pruned:
        dependencies.set_last_vault_sync(0.0)
        dependencies.logger.info("Pruned %d stale page entries from cache.", len(stale_paths))


def _without_stale_entries(
    raw_entries: list[PageCacheEntry],
) -> list[PageCacheEntry]:
    dependencies = _deps()
    now = time.monotonic()
    if now - dependencies.last_stale_check["ts"] <= dependencies.stale_check_ttl:
        return list(raw_entries)
    entries: list[PageCacheEntry] = []
    stale_paths: list[str] = []
    for entry in raw_entries:
        path_value = str(entry.get("path") or "")
        if path_value and not Path(path_value).exists():
            stale_paths.append(path_value)
        else:
            entries.append(entry)
    dependencies.last_stale_check["ts"] = now
    _remove_stale_entries(stale_paths)
    return entries


def _calendar_relevant(
    metadata: Metadata,
    resolved_table_id: str | None,
    enabled_tables: set[str],
) -> bool:
    table_id = resolved_table_id or metadata.get("table_id") or metadata.get("database_table_id")
    if table_id and str(table_id) in enabled_tables:
        return True
    if metadata.get("date"):
        return True
    source = str(metadata.get("source") or "").strip().lower()
    return bool(source and source not in {"gnosi", "gnosi vault"})


def _page_from_entry(
    entry: PageCacheEntry,
    folder_to_table: dict[str, str],
    sorted_folders: list[str],
) -> tuple[str, Metadata, PageInfo]:
    dependencies = _deps()
    raw_metadata = entry.get("metadata")
    metadata = raw_metadata if is_record(raw_metadata) else {}
    folder = str(entry.get("folder") or "")
    resolved_table_id = dependencies.resolve_table_id(
        metadata,
        folder,
        folder_to_table,
        sorted_folders,
    )
    page_id = str(entry["id"])
    modified = float_value(entry["mtime"])
    raw_created = entry.get("created_mtime") or modified
    created = float_value(raw_created)
    page = PageInfo.model_construct(
        id=page_id,
        title=str(entry["title"]),
        parent_id=entry["parent_id"],
        is_database=bool(entry["is_database"]),
        metadata=metadata,
        last_modified=datetime.fromtimestamp(modified).isoformat(),
        created_time=datetime.fromtimestamp(created).isoformat(),
        size=integer_value(entry["size"]),
        folder=folder,
        path=str(entry.get("path")) if entry.get("path") else None,
        resolved_table_id=resolved_table_id,
    )
    return page_id, metadata, page


def _build_pages(
    entries: list[PageCacheEntry],
    registry: RegistryData,
    only_calendar: bool,
    enabled_tables: set[str],
) -> list[PageInfo]:
    dependencies = _deps()
    folder_to_table = dependencies.build_table_folder_index(registry)
    sorted_folders = sorted(folder_to_table, key=len, reverse=True)
    hidden_ids = dependencies.hidden_event_ids()
    pages_by_id: dict[str, PageInfo] = {}
    duplicate_ids: set[str] = set()
    for entry in entries:
        page_id = str(entry["id"])
        if page_id in hidden_ids:
            continue
        page_id, metadata, page = _page_from_entry(
            entry,
            folder_to_table,
            sorted_folders,
        )
        if only_calendar and not _calendar_relevant(
            metadata,
            page.resolved_table_id,
            enabled_tables,
        ):
            continue
        existing = pages_by_id.get(page_id)
        if existing is None or page.last_modified > existing.last_modified:
            pages_by_id[page_id] = page
        if existing is not None:
            duplicate_ids.add(page_id)
    if duplicate_ids:
        dependencies.logger.debug(
            "Deduplicated %d pages with repeated ID in the Vault",
            len(duplicate_ids),
        )
    return sorted(
        pages_by_id.values(),
        key=lambda page: page.last_modified,
        reverse=True,
    )


def _refresh_sidebar_metadata(pages: list[PageInfo]) -> None:
    dependencies = _deps()
    targets = [
        page for page in pages if not page.folder or page.folder.startswith(SIDEBAR_FOLDER_PREFIXES)
    ]
    if not targets:
        return
    try:
        refresh_table_pages_metadata(targets)
    except Exception as error:
        dependencies.logger.debug("sidebar metadata refresh skipped: %s", error)


def get_pages_snapshot(
    only_calendar: bool = False,
    background_tasks: BackgroundTasks | None = None,
) -> list[PageInfo]:
    """Build the canonical, deduplicated page snapshot for one vault."""
    dependencies = _deps()
    cache_key = f"snapshot:{dependencies.vault_cache_key()}:{'cal' if only_calendar else 'all'}"
    cached = dependencies.cache_get(cache_key)
    if cached is not None:
        return cached
    registry = dependencies.load_registry()
    try:
        search_paths, enabled_tables = _calendar_scope(only_calendar, registry)
    except Exception as error:
        dependencies.logger.warning(
            "Could not prepare selective search paths for calendar: %s", error
        )
        search_paths, enabled_tables = (None, set())
    _schedule_background_syncs(background_tasks, only_calendar, search_paths)
    raw_entries = get_cached_page_entries(search_paths=search_paths)
    if not raw_entries:
        return []
    entries = _filter_by_search_paths(
        _without_stale_entries(raw_entries),
        search_paths,
    )
    pages = _build_pages(entries, registry, only_calendar, enabled_tables)
    _refresh_sidebar_metadata(pages)
    dependencies.cache_set(cache_key, pages)
    return pages


def cached_page_entry_count(vault_key: str) -> int:
    """Return the number of cached page entries for one vault."""
    dependencies = _deps()
    with dependencies.index_lock:
        return len(dependencies.index_entries.get(vault_key, {}))


# Mechanical-extraction names retained for idempotent recovery and old imports.
_refresh_page_index_entry = refresh_page_index_entry
_refresh_table_pages_metadata = refresh_table_pages_metadata
_get_cached_page_entries = get_cached_page_entries
_bump_page_index_version = bump_page_index_version
_get_pages_snapshot = get_pages_snapshot


__all__ = [
    "Metadata",
    "PageCacheEntry",
    "PageIndexDependencies",
    "bump_page_index_version",
    "cached_page_entry_count",
    "configure",
    "get_cached_page_entries",
    "get_pages_snapshot",
    "refresh_page_index_entry",
    "refresh_table_pages_metadata",
]
