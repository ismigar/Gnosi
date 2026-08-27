"""Table schema revisions and property mutation rules."""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException

from backend.domains.vault.registry.names import (
    normalize_main_view_configuration,
    table_name_from_registry,
)
from backend.domains.vault.registry.state import RegistryData


_VIEW_REF_LIST_KEYS = ("visibleProperties", "visible_properties", "columns")
_VIEW_REF_SCALAR_KEYS = ("groupBy", "dateField", "coverField", "groupSort")
_VIEW_REF_FIELD_LIST_KEYS = ("sorts", "filters")
_VIEW_REF_DICT_KEYS = ("columnWidths", "aggregations")
_FILTER_TREE_CHILD_KEYS = ("rules", "conditions", "children", "groups", "filters")


@dataclass(frozen=True)
class PropertyDependencies:
    load_registry: Callable[[], RegistryData]
    save_registry: Callable[[RegistryData], None]
    registry_mutation: Callable[[], AbstractContextManager[None]]
    get_prop_options: Callable[[RegistryData], list[RegistryData]]
    set_prop_options: Callable[[RegistryData, object], None]
    normalize_options: Callable[[object], list[RegistryData]]
    option_types: frozenset[str] | set[str]


def ensure_main_view(registry: RegistryData, table_id: str) -> RegistryData | None:
    """Guarantee that a table owns at least one canonical main view."""
    raw_views = registry.setdefault("views", [])
    views = raw_views if isinstance(raw_views, list) else []
    table_views = [
        view for view in views if isinstance(view, dict) and view.get("table_id") == table_id
    ]
    table_name = table_name_from_registry(registry, table_id)
    existing_main = next((view for view in table_views if view.get("is_main")), None)
    if existing_main is not None:
        if normalize_main_view_configuration(registry, existing_main):
            return existing_main
        return None
    promote_candidate = next(
        (view for view in table_views if view.get("type") == "table"), None
    ) or (table_views[0] if table_views else None)
    if promote_candidate is not None:
        promote_candidate["is_main"] = True
        promote_candidate["name"] = table_name
        normalize_main_view_configuration(registry, promote_candidate)
        return promote_candidate
    new_view: RegistryData = {
        "id": str(uuid.uuid4()),
        "table_id": table_id,
        "name": table_name,
        "is_main": True,
    }
    normalize_main_view_configuration(registry, new_view)
    views.append(new_view)
    registry["views"] = views
    return new_view


def table_schema_signature(properties: object) -> str:
    """Return a deterministic signature for one ordered property schema."""
    return json.dumps(
        properties if isinstance(properties, list) else [],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def schema_revision(value: object) -> int:
    """Parse a non-negative schema revision without trusting client types."""
    if not isinstance(value, (str, bytes, bytearray, int, float)):
        return 0
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def reconcile_table_schema_revision(
    old_table: RegistryData,
    incoming_table: RegistryData,
) -> None:
    """Reject a stale full-table update before it restores an old schema."""
    old_revision = schema_revision(old_table.get("schema_revision"))
    incoming_revision = schema_revision(incoming_table.get("schema_revision"))
    schema_changed = table_schema_signature(old_table.get("properties")) != table_schema_signature(
        incoming_table.get("properties")
    )
    if schema_changed and old_revision and incoming_revision != old_revision:
        raise HTTPException(
            status_code=409,
            detail=(
                "The table schema changed after this editor loaded it. "
                "Reload the table before saving schema changes."
            ),
        )
    if schema_changed:
        incoming_table["schema_revision"] = old_revision + 1
    elif old_revision:
        incoming_table["schema_revision"] = old_revision
    if old_table.get("schema_source") and not incoming_table.get("schema_source"):
        incoming_table["schema_source"] = old_table["schema_source"]


def rename_field_in_filter_tree(node: object, old: str, new: str) -> bool:
    """Recursively rewrite a field reference inside a filter tree."""
    if not isinstance(node, dict):
        return False
    changed = False
    if node.get("field") == old:
        node["field"] = new
        changed = True
    for child_key in _FILTER_TREE_CHILD_KEYS:
        children = node.get(child_key)
        if isinstance(children, list):
            for child in children:
                if rename_field_in_filter_tree(child, old, new):
                    changed = True
    return changed


def rename_field_refs_in_view_like(container: object, old: str, new: str) -> bool:
    """Rewrite all field-name references in one view or embedded section."""
    if not isinstance(container, dict) or not old or old == new:
        return False
    changed = _rename_list_references(container, old, new)
    changed = _rename_scalar_references(container, old, new) or changed
    changed = _rename_sort_references(container, old, new) or changed
    changed = _rename_field_list_references(container, old, new) or changed
    changed = _rename_dictionary_references(container, old, new) or changed
    tree = container.get("filterTree")
    if isinstance(tree, dict) and rename_field_in_filter_tree(tree, old, new):
        changed = True
    return changed


def _rename_list_references(container: dict[str, Any], old: str, new: str) -> bool:
    changed = False
    for key in _VIEW_REF_LIST_KEYS:
        value = container.get(key)
        if isinstance(value, list) and old in value:
            container[key] = [new if item == old else item for item in value]
            changed = True
    return changed


def _rename_scalar_references(container: dict[str, Any], old: str, new: str) -> bool:
    changed = False
    for key in _VIEW_REF_SCALAR_KEYS:
        if container.get(key) == old:
            container[key] = new
            changed = True
    return changed


def _rename_sort_references(container: dict[str, Any], old: str, new: str) -> bool:
    changed = False
    sort_value = container.get("sort")
    if isinstance(sort_value, dict):
        if sort_value.get("field") == old:
            sort_value["field"] = new
            changed = True
    elif isinstance(sort_value, list):
        for item in sort_value:
            if isinstance(item, dict) and item.get("field") == old:
                item["field"] = new
                changed = True
    return changed


def _rename_field_list_references(container: dict[str, Any], old: str, new: str) -> bool:
    changed = False
    for key in _VIEW_REF_FIELD_LIST_KEYS:
        value = container.get(key)
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict) and item.get("field") == old:
                    item["field"] = new
                    changed = True
    return changed


def _rename_dictionary_references(container: dict[str, Any], old: str, new: str) -> bool:
    changed = False
    for key in _VIEW_REF_DICT_KEYS:
        value = container.get(key)
        if isinstance(value, dict) and old in value:
            value[new] = value.pop(old)
            changed = True
    return changed


def propagate_property_rename(
    registry: RegistryData,
    table_id: str,
    old_name: str,
    new_name: str,
) -> int:
    """Rewrite a renamed property in table views and embedded sections."""
    if not old_name or old_name == new_name:
        return 0
    return _propagate_view_property_rename(
        registry, table_id, old_name, new_name
    ) + _propagate_section_property_rename(registry, table_id, old_name, new_name)


def _propagate_view_property_rename(
    registry: RegistryData,
    table_id: str,
    old_name: str,
    new_name: str,
) -> int:
    changed = 0
    raw_views = registry.get("views", [])
    for view in raw_views if isinstance(raw_views, list) else []:
        if not isinstance(view, dict) or view.get("table_id") != table_id:
            continue
        if rename_field_refs_in_view_like(view, old_name, new_name):
            changed += 1
    return changed


def _propagate_section_property_rename(
    registry: RegistryData,
    table_id: str,
    old_name: str,
    new_name: str,
) -> int:
    changed = 0
    pages = registry.get("pages")
    page_iterable = pages.values() if isinstance(pages, dict) else (pages or [])
    for page in page_iterable:
        if not isinstance(page, dict):
            continue
        sections = page.get("sections") or []
        for section in sections if isinstance(sections, list) else []:
            if not isinstance(section, dict):
                continue
            section_table = (
                section.get("source_table_id") or section.get("table_id") or section.get("tableId")
            )
            if section_table and section_table != table_id:
                continue
            if rename_field_refs_in_view_like(section, old_name, new_name):
                changed += 1
    return changed


def _find_target_property(
    registry: RegistryData,
    table_id: str,
    field_id: str,
) -> tuple[RegistryData, RegistryData, list[RegistryData]]:
    raw_tables = registry.get("tables", [])
    tables = [item for item in raw_tables if isinstance(item, dict)]
    table = next((item for item in tables if item.get("id") == table_id), None)
    if not table:
        raise HTTPException(status_code=404, detail=f"Table {table_id} not found")
    raw_properties = table.get("properties", []) or []
    properties = [item for item in raw_properties if isinstance(item, dict)]
    prop = next((item for item in properties if item.get("id") == field_id), None)
    if not prop:
        raise HTTPException(
            status_code=404,
            detail=f"Property {field_id} not found in table {table_id}",
        )
    return table, prop, properties


def _apply_property_name(
    registry: RegistryData,
    table_id: str,
    table: RegistryData,
    target: RegistryData,
    properties: list[RegistryData],
    requested_name: object,
) -> None:
    if not isinstance(requested_name, str) or not requested_name.strip():
        return
    new_name = requested_name.strip()
    collision = next(
        (
            prop
            for prop in properties
            if prop is not target and str(prop.get("name") or "").strip() == new_name
        ),
        None,
    )
    if collision:
        raise HTTPException(
            status_code=409,
            detail=f"A property named '{new_name}' already exists in the table",
        )
    old_name = str(target.get("name") or "").strip()
    if old_name and old_name != new_name:
        _record_property_aliases(target, properties, old_name, new_name)
        propagate_property_rename(registry, table_id, old_name, new_name)
    target["name"] = new_name


def _record_property_aliases(
    target: RegistryData,
    properties: list[RegistryData],
    old_name: str,
    new_name: str,
) -> None:
    raw_aliases = target.get("aliases") or []
    aliases = list(raw_aliases) if isinstance(raw_aliases, list) else []
    if old_name not in aliases:
        aliases.append(old_name)
    target["aliases"] = [alias for alias in aliases if alias != new_name]
    for prop in properties:
        if prop is target:
            continue
        prop_aliases = prop.get("aliases") or []
        if isinstance(prop_aliases, list) and new_name in prop_aliases:
            prop["aliases"] = [alias for alias in prop_aliases if alias != new_name]


def _apply_property_config(
    target: RegistryData,
    requested_config: object,
    dependencies: PropertyDependencies,
) -> None:
    if not isinstance(requested_config, dict):
        return
    raw_existing = target.get("config") or {}
    existing = dict(raw_existing) if isinstance(raw_existing, dict) else {}
    prior_options = dependencies.get_prop_options(target)
    existing.update(requested_config)
    target["config"] = existing
    if "options" not in requested_config or target.get("type") not in dependencies.option_types:
        return
    prior_by_name = {str(option["name"]): option for option in prior_options}
    raw_options = existing.get("options") or []
    options = raw_options if isinstance(raw_options, list) else []
    merged = [prior_by_name.get(item, item) if isinstance(item, str) else item for item in options]
    dependencies.set_prop_options(target, dependencies.normalize_options(merged))


def patch_table_property_locked(
    table_id: str,
    field_id: str,
    data: RegistryData,
    dependencies: PropertyDependencies,
) -> RegistryData:
    registry = dependencies.load_registry()
    target_table, target_property, properties = _find_target_property(registry, table_id, field_id)
    _apply_property_name(
        registry,
        table_id,
        target_table,
        target_property,
        properties,
        data.get("name"),
    )
    requested_type = data.get("type")
    if isinstance(requested_type, str):
        target_property["type"] = requested_type
    _apply_property_config(target_property, data.get("config"), dependencies)
    dependencies.save_registry(registry)
    return {
        "status": "success",
        "table_id": table_id,
        "property": target_property,
    }


async def patch_table_property(
    table_id: str,
    field_id: str,
    data: RegistryData,
    dependencies: PropertyDependencies,
) -> RegistryData:
    with dependencies.registry_mutation():
        return patch_table_property_locked(table_id, field_id, data, dependencies)


__all__ = [
    "PropertyDependencies",
    "ensure_main_view",
    "patch_table_property",
    "patch_table_property_locked",
    "propagate_property_rename",
    "reconcile_table_schema_revision",
    "rename_field_in_filter_tree",
    "rename_field_refs_in_view_like",
    "schema_revision",
    "table_schema_signature",
]
