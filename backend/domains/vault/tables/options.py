"""Shared option catalogs and row-value rewrites."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from fastapi import HTTPException

from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.schemas.pages import PageInfo


class PageFinder(Protocol):
    def __call__(
        self,
        page_id: str,
        *,
        allow_full_scan: bool = True,
    ) -> Path | None: ...


@dataclass(frozen=True)
class OptionDependencies:
    load_registry: Callable[[], RegistryData]
    save_registry: Callable[[RegistryData], None]
    registry_mutation: Callable[[], AbstractContextManager[None]]
    pages_for_table: Callable[[str], list[PageInfo]]
    find_page: PageFinder
    materialize: Callable[[Path, str], Awaitable[None]]
    parse_frontmatter: Callable[[str, Path | None], tuple[RegistryData, str]]
    save_page: Callable[[Path, RegistryData, str], object]
    refresh_page_cache: Callable[[Path, RegistryData, str, PageInfo], None]
    invalidate_page_responses: Callable[[], None]
    read_prop_value: Callable[[RegistryData, RegistryData], object]
    get_prop_config: Callable[[RegistryData], RegistryData]
    get_prop_options: Callable[[RegistryData, RegistryData | None], list[RegistryData]]
    set_prop_options: Callable[[RegistryData, list[RegistryData]], None]
    normalize_options: Callable[[object], list[RegistryData]]
    auto_color: Callable[[str], str]
    is_global_status_prop: Callable[[RegistryData], bool]
    status_catalog_ref: str
    logger: logging.Logger


def _registry_items(registry: RegistryData, key: str) -> list[RegistryData]:
    raw_items = registry.get(key, [])
    return [item for item in raw_items if isinstance(item, dict)]


def find_table_and_property(
    registry: RegistryData,
    table_id: str,
    field_reference: str,
) -> tuple[RegistryData, RegistryData]:
    """Find a property by immutable ID or current name."""
    table = next(
        (item for item in _registry_items(registry, "tables") if item.get("id") == table_id),
        None,
    )
    if not table:
        raise HTTPException(status_code=404, detail=f"Table {table_id} not found")
    prop = next(
        (
            item
            for item in _registry_items(table, "properties")
            if item.get("id") == field_reference
            or str(item.get("name") or "").strip() == field_reference
        ),
        None,
    )
    if not prop:
        raise HTTPException(
            status_code=404,
            detail=f"Property {field_reference} not found in table",
        )
    return table, prop


def option_value_keys(prop: RegistryData) -> list[str]:
    """Return all persisted frontmatter keys accepted for a property."""
    keys: list[str] = []
    if prop.get("id"):
        keys.append(str(prop["id"]))
    if prop.get("name"):
        keys.append(str(prop["name"]))
    raw_aliases = prop.get("aliases") or []
    if isinstance(raw_aliases, list):
        keys.extend(str(alias) for alias in raw_aliases if alias)
    return keys


def global_status_members(
    registry: RegistryData,
    dependencies: OptionDependencies,
) -> list[tuple[RegistryData, RegistryData]]:
    """Return all table/property pairs backed by the global status catalog."""
    return [
        (table, prop)
        for table in _registry_items(registry, "tables")
        for prop in _registry_items(table, "properties")
        if dependencies.is_global_status_prop(prop)
    ]


def _rewrite_multi_value(value: object, old: str, new: str | None) -> list[str] | None:
    if isinstance(value, list):
        values = [str(item) for item in value]
    elif value:
        values = [item.strip() for item in str(value).split(",") if item.strip()]
    else:
        values = []
    if old not in values:
        return None
    output: list[str] = []
    for item in values:
        replacement = new if item == old else item
        if replacement and replacement not in output:
            output.append(replacement)
    return output


def _rewrite_metadata_option(
    metadata: RegistryData,
    keys: list[str],
    old: str,
    new: str | None,
    *,
    multiple: bool,
) -> bool:
    modified = False
    for key in keys:
        if key not in metadata:
            continue
        value = metadata[key]
        if multiple:
            rewritten = _rewrite_multi_value(value, old, new)
            if rewritten is None:
                continue
            metadata[key] = rewritten
            modified = True
        elif str(value) == old:
            metadata[key] = new or ""
            modified = True
    return modified


async def rewrite_option_in_rows(
    table: RegistryData,
    prop: RegistryData,
    old: str,
    new: str | None,
    dependencies: OptionDependencies,
) -> int:
    """Rewrite one option value across every row in a table."""
    table_id = str(table.get("id") or "")
    rows = await asyncio.to_thread(dependencies.pages_for_table, table_id)
    keys = option_value_keys(prop)
    multiple = prop.get("type") == "multi_select"
    changed = 0
    for row in rows:
        file_path = await asyncio.to_thread(dependencies.find_page, row.id)
        if not file_path or not file_path.exists():
            continue
        await dependencies.materialize(file_path, f"option-rewrite/{row.id}")
        try:
            raw = await asyncio.to_thread(file_path.read_text, encoding="utf-8")
            metadata, body = dependencies.parse_frontmatter(raw, file_path)
        except Exception as error:
            dependencies.logger.warning("option-rewrite: could not read %s: %s", row.id, error)
            continue
        if not _rewrite_metadata_option(
            metadata,
            keys,
            old,
            new,
            multiple=multiple,
        ):
            continue
        try:
            await asyncio.to_thread(dependencies.save_page, file_path, metadata, body)
            changed += 1
        except Exception as error:
            dependencies.logger.warning("option-rewrite: could not write %s: %s", row.id, error)
            continue
        try:
            dependencies.refresh_page_cache(file_path, metadata, body, row)
        except Exception as error:
            dependencies.logger.debug(
                "option-rewrite: cache update failed for %s: %s", row.id, error
            )
    if changed:
        dependencies.invalidate_page_responses()
    return changed


async def table_option_usage(
    table_id: str,
    field_id: str,
    dependencies: OptionDependencies,
) -> RegistryData:
    registry = dependencies.load_registry()
    table, prop = find_table_and_property(registry, table_id, field_id)
    counts: dict[str, int] = {}
    members = (
        global_status_members(registry, dependencies)
        if dependencies.is_global_status_prop(prop)
        else [(table, prop)]
    )
    total_rows = 0
    for member_table, member_property in members:
        member_table_id = str(member_table.get("id") or "")
        rows = await asyncio.to_thread(dependencies.pages_for_table, member_table_id)
        total_rows += len(rows)
        for row in rows:
            value = dependencies.read_prop_value(row.metadata or {}, member_property)
            if value in (None, "", []):
                continue
            values = (
                [str(item).strip() for item in value]
                if isinstance(value, list)
                else [str(value).strip()]
            )
            for item in values:
                if item:
                    counts[item] = counts.get(item, 0) + 1
    return {
        "field": prop.get("name"),
        "counts": counts,
        "total_rows": total_rows,
    }


def _status_options(
    registry: RegistryData,
    dependencies: OptionDependencies,
) -> list[RegistryData]:
    return dependencies.get_prop_options(
        {"config": {"catalog_ref": dependencies.status_catalog_ref}},
        registry.get("option_catalogs"),
    )


def _rename_global_option(
    registry: RegistryData,
    old: str,
    new: str,
    dependencies: OptionDependencies,
) -> list[tuple[RegistryData, RegistryData]]:
    options = _status_options(registry, dependencies)
    names = {str(option["name"]) for option in options}
    renamed: list[RegistryData] = []
    for option in options:
        if option["name"] == old:
            if new in names:
                continue
            option = {**option, "name": new}
        renamed.append(option)
    catalogs = registry.setdefault("option_catalogs", {})
    if not isinstance(catalogs, dict):
        catalogs = {}
        registry["option_catalogs"] = catalogs
    catalogs[dependencies.status_catalog_ref] = renamed
    for _, status_property in global_status_members(registry, dependencies):
        status_config = dependencies.get_prop_config(status_property)
        if str(status_config.get("default_option") or "") == old:
            status_config["default_option"] = new
    dependencies.save_registry(registry)
    return global_status_members(registry, dependencies)


def _rename_local_option(
    registry: RegistryData,
    table: RegistryData,
    prop: RegistryData,
    config: RegistryData,
    old: str,
    new: str,
    dependencies: OptionDependencies,
) -> list[tuple[RegistryData, RegistryData]]:
    options = dependencies.get_prop_options(prop, None)
    names = {str(option["name"]) for option in options}
    renamed: list[RegistryData] = []
    for option in options:
        if option["name"] == old:
            if new in names:
                continue
            option = {**option, "name": new}
        renamed.append(option)
    dependencies.set_prop_options(prop, renamed)
    if str(config.get("default_option") or "") == old:
        config["default_option"] = new
    dependencies.save_registry(registry)
    return [(table, prop)]


def _rename_catalog_option(
    registry: RegistryData,
    table: RegistryData,
    prop: RegistryData,
    old: str,
    new: str,
    dependencies: OptionDependencies,
) -> list[tuple[RegistryData, RegistryData]]:
    config = dependencies.get_prop_config(prop)
    if dependencies.is_global_status_prop(prop):
        return _rename_global_option(registry, old, new, dependencies)
    if not str(config.get("catalog_ref") or "").strip():
        return _rename_local_option(registry, table, prop, config, old, new, dependencies)
    return []


async def rename_table_option(
    table_id: str,
    payload: RegistryData,
    dependencies: OptionDependencies,
) -> RegistryData:
    field_reference = str(payload.get("field_id") or payload.get("field") or "").strip()
    old = str(payload.get("old") or "").strip()
    new = str(payload.get("new") or "").strip()
    if not field_reference or not old or not new:
        raise HTTPException(
            status_code=400,
            detail="field_id, old i new són obligatoris",
        )
    if old == new:
        return {"status": "ok", "files_changed": 0}
    with dependencies.registry_mutation():
        registry = dependencies.load_registry()
        table, prop = find_table_and_property(registry, table_id, field_reference)
        members = _rename_catalog_option(registry, table, prop, old, new, dependencies)
    files_changed = 0
    for member_table, member_property in members:
        files_changed += await rewrite_option_in_rows(
            member_table,
            member_property,
            old,
            new,
            dependencies,
        )
    catalogs = registry.get("option_catalogs", {})
    response_options = (
        catalogs.get(dependencies.status_catalog_ref)
        if dependencies.is_global_status_prop(prop) and isinstance(catalogs, dict)
        else None
    )
    return {
        "status": "ok",
        "files_changed": files_changed,
        "options": response_options,
    }


def _remove_global_option(
    registry: RegistryData,
    value: str,
    dependencies: OptionDependencies,
) -> list[tuple[RegistryData, RegistryData]]:
    options = [
        option for option in _status_options(registry, dependencies) if option["name"] != value
    ]
    catalogs = registry.setdefault("option_catalogs", {})
    if not isinstance(catalogs, dict):
        catalogs = {}
        registry["option_catalogs"] = catalogs
    catalogs[dependencies.status_catalog_ref] = options
    for _, status_property in global_status_members(registry, dependencies):
        status_config = dependencies.get_prop_config(status_property)
        if str(status_config.get("default_option") or "") == value:
            status_config.pop("default_option", None)
    dependencies.save_registry(registry)
    return global_status_members(registry, dependencies)


def _remove_local_option(
    registry: RegistryData,
    table: RegistryData,
    prop: RegistryData,
    config: RegistryData,
    value: str,
    dependencies: OptionDependencies,
) -> list[tuple[RegistryData, RegistryData]]:
    options = [
        option for option in dependencies.get_prop_options(prop, None) if option["name"] != value
    ]
    dependencies.set_prop_options(prop, options)
    if str(config.get("default_option") or "") == value:
        config.pop("default_option", None)
    dependencies.save_registry(registry)
    return [(table, prop)]


def _remove_catalog_option(
    registry: RegistryData,
    table: RegistryData,
    prop: RegistryData,
    value: str,
    dependencies: OptionDependencies,
) -> list[tuple[RegistryData, RegistryData]]:
    config = dependencies.get_prop_config(prop)
    if dependencies.is_global_status_prop(prop):
        return _remove_global_option(registry, value, dependencies)
    if not str(config.get("catalog_ref") or "").strip():
        return _remove_local_option(registry, table, prop, config, value, dependencies)
    return []


async def remove_table_option(
    table_id: str,
    payload: RegistryData,
    dependencies: OptionDependencies,
) -> RegistryData:
    field_reference = str(payload.get("field_id") or payload.get("field") or "").strip()
    value = str(payload.get("value") or "").strip()
    reassign_to = str(payload.get("reassign_to") or "").strip() or None
    if not field_reference or not value:
        raise HTTPException(
            status_code=400,
            detail="field_id and value are required",
        )
    if reassign_to == value:
        raise HTTPException(
            status_code=400,
            detail="Cannot reassign to the same option",
        )
    with dependencies.registry_mutation():
        registry = dependencies.load_registry()
        table, prop = find_table_and_property(registry, table_id, field_reference)
        members = _remove_catalog_option(registry, table, prop, value, dependencies)
    files_changed = 0
    for member_table, member_property in members:
        files_changed += await rewrite_option_in_rows(
            member_table,
            member_property,
            value,
            reassign_to,
            dependencies,
        )
    catalogs = registry.get("option_catalogs", {})
    response_options = (
        catalogs.get(dependencies.status_catalog_ref)
        if dependencies.is_global_status_prop(prop) and isinstance(catalogs, dict)
        else None
    )
    return {
        "status": "ok",
        "files_changed": files_changed,
        "options": response_options,
    }


async def _recover_status_values(
    members: list[tuple[RegistryData, RegistryData]],
    known_names: set[str],
    dependencies: OptionDependencies,
) -> list[str]:
    recovered: list[str] = []
    for table, prop in members:
        table_id = str(table.get("id") or "")
        rows = await asyncio.to_thread(dependencies.pages_for_table, table_id)
        for row in rows:
            value = dependencies.read_prop_value(row.metadata or {}, prop)
            values = value if isinstance(value, list) else [value]
            for item in values:
                clean = str(item or "").strip()
                if clean and clean not in known_names:
                    known_names.add(clean)
                    recovered.append(clean)
    return recovered


def _persist_recovered_status_values(
    status_options: list[RegistryData],
    dependencies: OptionDependencies,
) -> RegistryData:
    with dependencies.registry_mutation():
        registry = dependencies.load_registry()
        catalogs = registry.setdefault("option_catalogs", {})
        if not isinstance(catalogs, dict):
            catalogs = {}
            registry["option_catalogs"] = catalogs
        catalogs[dependencies.status_catalog_ref] = status_options
        dependencies.save_registry(registry)
    return catalogs


async def list_option_catalogs(
    dependencies: OptionDependencies,
) -> RegistryData:
    registry = dependencies.load_registry()
    raw_catalogs = registry.get("option_catalogs") or {}
    catalogs = raw_catalogs if isinstance(raw_catalogs, dict) else {}
    status_options = dependencies.normalize_options(catalogs.get(dependencies.status_catalog_ref))
    status_names = {str(option["name"]) for option in status_options}
    status_members = global_status_members(registry, dependencies)
    recovered_values = await _recover_status_values(
        status_members,
        status_names,
        dependencies,
    )
    if recovered_values:
        status_options.extend(
            {
                "name": value,
                "color": dependencies.auto_color(value),
            }
            for value in recovered_values
        )
        catalogs = _persist_recovered_status_values(status_options, dependencies)
    return {
        "catalogs": {
            str(name): dependencies.normalize_options(options)
            for name, options in catalogs.items()
            if isinstance(options, list)
        }
    }


async def put_option_catalog(
    name: str,
    payload: RegistryData,
    dependencies: OptionDependencies,
) -> RegistryData:
    clean = (name or "").strip()
    if not clean:
        raise HTTPException(status_code=400, detail="Catalog name is required")
    options = dependencies.normalize_options(payload.get("options"))
    with dependencies.registry_mutation():
        registry = dependencies.load_registry()
        catalogs = registry.setdefault("option_catalogs", {})
        if not isinstance(catalogs, dict):
            catalogs = {}
            registry["option_catalogs"] = catalogs
        catalogs[clean] = options
        dependencies.save_registry(registry)
    return {"status": "ok", "name": clean, "options": options}


async def delete_option_catalog(
    name: str,
    dependencies: OptionDependencies,
) -> RegistryData:
    with dependencies.registry_mutation():
        registry = dependencies.load_registry()
        raw_catalogs = registry.get("option_catalogs") or {}
        catalogs = raw_catalogs if isinstance(raw_catalogs, dict) else {}
        if name not in catalogs:
            raise HTTPException(status_code=404, detail="Catalog not found")
        referenced_by = [
            f"{table.get('name')}/{prop.get('name')}"
            for table in _registry_items(registry, "tables")
            for prop in _registry_items(table, "properties")
            if str(dependencies.get_prop_config(prop).get("catalog_ref") or "") == name
        ]
        if referenced_by:
            raise HTTPException(
                status_code=409,
                detail=f"The catalog is used by: {', '.join(referenced_by)}",
            )
        catalogs.pop(name, None)
        dependencies.save_registry(registry)
    return {"status": "ok"}


__all__ = [
    "OptionDependencies",
    "delete_option_catalog",
    "find_table_and_property",
    "global_status_members",
    "list_option_catalogs",
    "option_value_keys",
    "put_option_catalog",
    "remove_table_option",
    "rename_table_option",
    "rewrite_option_in_rows",
    "table_option_usage",
]
