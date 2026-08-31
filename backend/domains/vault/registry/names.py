"""Canonical table and view naming rules stored in the registry."""

from __future__ import annotations

import re
import unicodedata

from backend.domains.vault.registry.records import is_object_list, is_record
from backend.domains.vault.registry.state import RegistryData
from backend.utils.open_values import integer_value, iterable_values


_TABLE_VIEW_EMOJI_RE = re.compile(
    r"[\U0001F000-\U0001FAFF\U0001FC00-\U0001FFFD\u2122\u2139"
    r"\u2300-\u23FF\u2600-\u27BF\u2B00-\u2BFF\u3030\u303D\u3297\u3299]"
)
_TABLE_VIEW_KEYCAP_RE = re.compile(r"[0-9#*]\uFE0F?\u20E3")
_TABLE_VIEW_EMOJI_CONTROL_RE = re.compile(r"[\u200D\u20E3\uFE0E\uFE0F]")
_LEGACY_MAIN_VIEW_NAMES = frozenset(
    {"main table", "taula principal", "vista principal", "tableau principal"}
)


def normalize_table_view_name(value: object, fallback: str) -> str:
    """Return a compact table/view label without decorative emoji."""
    raw = str(value or "")
    cleaned = _TABLE_VIEW_KEYCAP_RE.sub("", raw)
    cleaned = _TABLE_VIEW_EMOJI_RE.sub("", cleaned)
    cleaned = _TABLE_VIEW_EMOJI_CONTROL_RE.sub("", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or fallback


def table_name_from_registry(registry: RegistryData, table_id: object) -> str:
    """Return the normalized display name for a table ID."""
    table = next(
        (
            item
            for item in iterable_values(registry.get("tables", []) or [])
            if is_record(item) and str(item.get("id") or "") == str(table_id or "")
        ),
        None,
    )
    return normalize_table_view_name(
        (table or {}).get("name") or (table or {}).get("id"),
        "Untitled Table",
    )


def main_view_fields(registry: RegistryData, table_id: object) -> list[str]:
    """Return the canonical visible fields for a table's main view."""
    table = next(
        (
            item
            for item in iterable_values(registry.get("tables", []) or [])
            if is_record(item) and str(item.get("id") or "") == str(table_id or "")
        ),
        None,
    )
    fields = ["title"]
    for prop in iterable_values((table or {}).get("properties", []) or []):
        name = prop.get("name") if is_record(prop) else None
        if isinstance(name, str) and name and name not in fields:
            fields.append(name)
    return fields


def is_main_or_locked_view(view: RegistryData) -> bool:
    """Return whether a view is protected as a table's main view."""
    if view.get("is_main") or view.get("is_default") or view.get("id") == "default":
        return True
    normalized_name = normalize_table_view_name(view.get("name"), "View")
    if normalized_name.casefold() in _LEGACY_MAIN_VIEW_NAMES:
        return True
    return any(bool(view.get(key)) for key in ("locked", "is_locked", "isLocked"))


def normalize_main_view_configuration(
    registry: RegistryData,
    view: RegistryData,
) -> bool:
    """Enforce the immutable configuration of a main or locked view."""
    if not is_main_or_locked_view(view):
        return False

    table_id = view.get("table_id")
    table_name = table_name_from_registry(registry, table_id)
    sort: RegistryData = {"field": "title", "direction": "asc"}
    canonical: RegistryData = {
        "name": table_name,
        "type": "table",
        "filters": [],
        "filter": None,
        "filterTree": None,
        "sort": sort,
        "sorts": [dict(sort)],
        "groupBy": None,
        "group_by": None,
        "groupSort": None,
        "group_sort": None,
        "groupSortDir": "asc",
        "group_sort_dir": "asc",
        "visibleProperties": main_view_fields(registry, table_id),
    }
    changed = False
    for key, value in canonical.items():
        if key not in view or view.get(key) != value:
            view[key] = value
            changed = True
    if not view.get("is_main"):
        view["is_main"] = True
        changed = True
    return changed


def normalize_registry_table_view_names(registry: RegistryData) -> bool:
    """Normalize persisted table/view labels and canonicalize main views."""
    raw_tables = registry.setdefault("tables", [])
    raw_views = registry.setdefault("views", [])
    tables = raw_tables if is_object_list(raw_tables) else []
    views = raw_views if is_object_list(raw_views) else []
    changed, table_names = _normalize_table_names(tables)
    return _normalize_view_names(registry, views, table_names) or changed


def _normalize_table_names(
    tables: list[object],
) -> tuple[bool, dict[str, str]]:
    changed = False
    table_names: dict[str, str] = {}
    for table in tables:
        if not is_record(table):
            continue
        table_id = str(table.get("id") or "")
        old_name = table.get("name")
        new_name = normalize_table_view_name(old_name or table_id, "Untitled Table")
        if old_name != new_name:
            table["name"] = new_name
            changed = True
        if table_id:
            table_names[table_id] = new_name
    return changed, table_names


def _normalize_view_names(
    registry: RegistryData,
    views: list[object],
    table_names: dict[str, str],
) -> bool:
    changed = False
    for view in views:
        if not is_record(view):
            continue
        table_id = str(view.get("table_id") or "")
        table_name = table_names.get(table_id) or table_name_from_registry(registry, table_id)
        old_view_name = view.get("name")
        normalized_view_name = normalize_table_view_name(old_view_name, "View")
        is_main = is_main_or_locked_view(view)
        if is_main and not view.get("is_main"):
            view["is_main"] = True
            changed = True
        desired_name = table_name if is_main else normalized_view_name
        if old_view_name != desired_name:
            view["name"] = desired_name
            changed = True
        if normalize_main_view_configuration(registry, view):
            changed = True
    return changed


def sort_key_name(item: RegistryData) -> tuple[int, str]:
    """Sort by explicit order, then by accent-insensitive display name."""
    order = item.get("order")
    if order is not None:
        try:
            order_value = integer_value(order)
        except (ValueError, TypeError):
            order_value = 999999
    else:
        order_value = 999999
    name = str(item.get("name") or "").lower()
    normalized_name = "".join(
        character
        for character in unicodedata.normalize("NFD", name)
        if unicodedata.category(character) != "Mn"
    )
    return order_value, normalized_name


__all__ = [
    "is_main_or_locked_view",
    "main_view_fields",
    "normalize_main_view_configuration",
    "normalize_registry_table_view_names",
    "normalize_table_view_name",
    "sort_key_name",
    "table_name_from_registry",
]
