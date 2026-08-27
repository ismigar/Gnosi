"""Resilient persistence for the per-vault registry."""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from backend.domains.vault.registry.names import normalize_registry_table_view_names
from backend.domains.vault.registry.state import RegistryData, RegistryState


class JsonWriter(Protocol):
    def __call__(
        self,
        path: Path,
        data: object,
        *,
        indent: int,
        ensure_ascii: bool,
    ) -> None: ...


@dataclass(frozen=True)
class RegistryRepositoryDependencies:
    registry_path: Callable[[], Path | None]
    normalize_folder: Callable[[str | None], str]
    ensure_table_folder: Callable[[RegistryData, RegistryData], object]
    ensure_status_catalog: Callable[[RegistryData], bool]
    write_json: JsonWriter


class RegistryRepository:
    """Own registry I/O while sharing one explicit process state object."""

    def __init__(
        self,
        dependencies: RegistryRepositoryDependencies,
        state: RegistryState,
        logger: logging.Logger,
    ) -> None:
        self._dependencies = dependencies
        self.state = state
        self._log = logger

    @staticmethod
    def is_degenerate(data: object) -> bool:
        return not isinstance(data, dict) or (not data.get("databases") and not data.get("tables"))

    def degenerate_overwrite_is_risky(self, registry_path: Path) -> bool:
        try:
            if registry_path.exists():
                try:
                    previous = json.loads(registry_path.read_text(encoding="utf-8"))
                except Exception:
                    return True
                if not self.is_degenerate(previous):
                    return True
        except Exception:
            return True

        try:
            database_dir = registry_path.parent
            if not database_dir.is_dir():
                return False
            for entry in database_dir.iterdir():
                name = entry.name
                if entry.is_file():
                    if name.startswith("vault_db_registry") and name != registry_path.name:
                        return True
                    continue
                if name.startswith("."):
                    continue
                try:
                    if next(entry.iterdir(), None) is not None:
                        return True
                except Exception:
                    return True
        except Exception:
            return True
        return False

    @contextmanager
    def mutation(self) -> Iterator[None]:
        with self.state.mutation_lock:
            yield

    def update_cache(self, registry_path: Path, data: RegistryData) -> None:
        cache_key = str(registry_path)
        self.state.cache[cache_key] = data
        self.state.cache_timestamp[cache_key] = time.monotonic()
        try:
            self.state.cache_mtime[cache_key] = registry_path.stat().st_mtime
        except Exception:
            pass

    def load(self) -> RegistryData:
        now = time.monotonic()
        registry_path = self._dependencies.registry_path()
        empty: RegistryData = {"databases": [], "tables": [], "views": []}
        if not registry_path:
            return empty
        cache_key = str(registry_path)
        cached = self.state.cache.get(cache_key)

        if (
            cached is not None
            and (now - self.state.cache_timestamp.get(cache_key, 0.0))
            < self.state.cache_ttl_seconds
        ):
            return cached
        try:
            if not registry_path.exists():
                return cached if cached is not None else empty
            modified = registry_path.stat().st_mtime
            if cached is not None and modified <= self.state.cache_mtime.get(cache_key, 0.0):
                self.state.cache_timestamp[cache_key] = now
                return cached
        except Exception as error:
            if cached is not None:
                self._log.warning("⚠️ load_registry: stat failed (%s); serving stale cache", error)
                return cached
            self._log.error("❌ load_registry: stat failed and no cache available: %s", error)
            return empty

        try:
            with self.state.mutation_lock:
                return self.load_from_disk(registry_path, cache_key, now)
        except Exception as error:
            self._log.error("❌ Error loading registry: %s", error)
            if cached is not None:
                self._log.warning("⚠️ load_registry: serving stale cache after error")
                return cached
            return empty

    def load_from_disk(
        self,
        registry_path: Path,
        cache_key: str,
        now: float,
    ) -> RegistryData:
        raw_data: Any = json.loads(registry_path.read_text(encoding="utf-8"))
        if not isinstance(raw_data, dict):
            raise ValueError("Registry root must be an object")
        data: RegistryData = raw_data
        if not self.is_degenerate(data):
            self.state.seen_nondegenerate.add(cache_key)

        changed = self._drop_default_table(data)
        changed = self._drop_legacy_wiki(data) or changed
        changed = self._ensure_view_ids(data) or changed
        if normalize_registry_table_view_names(data):
            changed = True
        if self._dependencies.ensure_status_catalog(data):
            changed = True
        changed = self._normalize_table_folders(data) or changed
        if changed:
            self.save(data)
        self.state.cache[cache_key] = data
        self.state.cache_timestamp[cache_key] = now
        try:
            self.state.cache_mtime[cache_key] = registry_path.stat().st_mtime
        except Exception:
            pass
        return data

    def _drop_default_table(self, data: RegistryData) -> bool:
        raw_tables = data.get("tables", [])
        tables = raw_tables if isinstance(raw_tables, list) else []
        filtered = [
            table
            for table in tables
            if not isinstance(table, dict) or table.get("name") != "taula_1"
        ]
        if len(filtered) == len(tables):
            return False
        data["tables"] = filtered
        self._log.info("🗑️ Deleted the default table from the registry.")
        return True

    def _drop_legacy_wiki(self, data: RegistryData) -> bool:
        raw_tables = data.get("tables", [])
        tables = raw_tables if isinstance(raw_tables, list) else []
        filtered_tables = [
            table
            for table in tables
            if not isinstance(table, dict) or str(table.get("id") or "").strip().lower() != "wiki"
        ]
        if len(filtered_tables) == len(tables):
            return False
        raw_views = data.get("views", [])
        views = raw_views if isinstance(raw_views, list) else []
        data["tables"] = filtered_tables
        data["views"] = [
            view
            for view in views
            if not isinstance(view, dict)
            or str(view.get("table_id") or "").strip().lower() != "wiki"
        ]
        self._log.info("🧹 Removed legacy wiki table and its views from registry.")
        return True

    def _ensure_view_ids(self, data: RegistryData) -> bool:
        raw_views = data.get("views", [])
        views = raw_views if isinstance(raw_views, list) else []
        changed = False
        for view in views:
            if not isinstance(view, dict) or view.get("id"):
                continue
            view["id"] = str(uuid.uuid4())
            changed = True
            self._log.info(
                "🧹 Assigned UUID to view with null/empty ID: %s",
                view.get("name"),
            )
        return changed

    def _normalize_table_folders(self, data: RegistryData) -> bool:
        raw_tables = data.get("tables", [])
        tables = raw_tables if isinstance(raw_tables, list) else []
        changed = False
        for raw_table in tables:
            if not isinstance(raw_table, dict):
                continue
            table: RegistryData = raw_table
            changed = self._normalize_one_table_folder(table) or changed
            self._ensure_one_table_folder(table, data)
        return changed

    def _normalize_one_table_folder(self, table: RegistryData) -> bool:
        folder_value = table.get("folder") or table.get("name", "untitled_table")
        folder = self._dependencies.normalize_folder(
            str(folder_value) if folder_value is not None else None
        )
        if table.get("folder") == folder:
            return False
        table["folder"] = folder
        self._log.info("🧹 Normalized table path '%s': %s", table.get("name"), folder)
        return True

    def _ensure_one_table_folder(
        self,
        table: RegistryData,
        data: RegistryData,
    ) -> None:
        table_id = str(table.get("id") or "")
        if table_id and table_id in self.state.ensured_tables:
            return
        try:
            self._dependencies.ensure_table_folder(table, data)
            if table_id:
                self.state.ensured_tables.add(table_id)
        except Exception as error:
            self._log.error(
                "❌ Error ensuring folder for table %s: %s",
                table.get("name"),
                error,
            )

    def save(self, data: RegistryData) -> None:
        registry_path = self._dependencies.registry_path()
        if not registry_path:
            self._log.warning("⚠️ Registry save attempt without configured path.")
            return
        try:
            with self.state.mutation_lock:
                cache_key = str(registry_path)
                if self.is_degenerate(data):
                    if (
                        cache_key not in self.state.seen_nondegenerate
                        and self.degenerate_overwrite_is_risky(registry_path)
                    ):
                        self._log.error(
                            "🛑 Refused to overwrite the registry with an empty "
                            "structure: %s shows prior data that this process never "
                            "managed to read (likely a dataless/unsynced file). "
                            "Leaving it intact.",
                            registry_path,
                        )
                        return
                else:
                    self.state.seen_nondegenerate.add(cache_key)
                self._dependencies.write_json(
                    registry_path,
                    data,
                    indent=2,
                    ensure_ascii=False,
                )
                self.update_cache(registry_path, data)
        except Exception as error:
            self._log.error("❌ Error saving registry: %s", error)


__all__ = [
    "JsonWriter",
    "RegistryRepository",
    "RegistryRepositoryDependencies",
]
