"""Registry-wide status catalog migration."""

from __future__ import annotations

from backend.domains.vault.registry.records import is_record
from backend.utils.open_values import get_value, set_value, pop_value

from backend.domains.vault.tables.catalogs.core import (
    auto_color,
    get_prop_config,
    get_prop_options,
    is_global_status_prop,
    normalize_options,
)
from backend.domains.vault.tables.catalogs.roles import table_has_social_column
from backend.domains.vault.tables.catalogs.seeds import (
    BASE_STATUS_SEED,
    DEFAULT_STATUS_GROUPS,
    STATUS_CATALOG_REF,
    STATUS_PUBLISHED_DRUPAL,
    STATUS_PUBLISHED_SOCIAL,
    STATUS_TRANSLATED,
)
from backend.domains.vault.tables.catalogs.types import Metadata, Option, Seed

StatusMember = tuple[Metadata, Metadata]


def _tables(registry: Metadata) -> list[Metadata]:
    raw_tables = registry.get("tables") or []
    if not isinstance(raw_tables, list):
        return []
    return [table for table in raw_tables if is_record(table)]


def _properties(table: Metadata) -> list[Metadata]:
    raw_properties = table.get("properties") or []
    if not isinstance(raw_properties, list):
        return []
    return [prop for prop in raw_properties if is_record(prop)]


def _root_catalogs(registry: Metadata) -> Metadata:
    catalogs = registry.get("option_catalogs")
    return catalogs if is_record(catalogs) else {}


def _status_members(registry: Metadata) -> list[StatusMember]:
    return [
        (table, prop)
        for table in _tables(registry)
        for prop in _properties(table)
        if is_global_status_prop(prop)
    ]


def _merge_member_options(
    members: list[StatusMember],
    root_catalogs: Metadata,
) -> list[Option]:
    merged = normalize_options(root_catalogs.get(STATUS_CATALOG_REF))
    names = {str(option["name"]) for option in merged}
    for _, prop in members:
        for option in get_prop_options(prop, root_catalogs):
            name = str(option["name"])
            if name not in names:
                merged.append(option)
                names.add(name)
    return merged


def _wanted_statuses(members: list[StatusMember]) -> list[Seed]:
    wanted = list(BASE_STATUS_SEED)
    if any(table.get("translation_enabled") for table, _ in members):
        wanted.append((STATUS_TRANSLATED, "En curs"))
    if any(table.get("drupal_sync_enabled") for table, _ in members):
        wanted.append((STATUS_PUBLISHED_DRUPAL, "Final"))
    if any(table_has_social_column(table) for table, _ in members):
        wanted.append((STATUS_PUBLISHED_SOCIAL, "Final"))
    return wanted


def _append_missing(merged: list[Option], wanted: list[Seed]) -> None:
    names = {str(option["name"]) for option in merged}
    for name, group in wanted:
        if name in names:
            continue
        option: Option = {"name": name, "color": auto_color(name)}
        if group:
            option["group"] = group
        merged.append(option)
        names.add(name)


def _configure_status_property(prop: Metadata) -> bool:
    config = prop.setdefault("config", {})
    changed = False
    if get_value(config, "catalog_ref") != STATUS_CATALOG_REF:
        set_value(config, "catalog_ref", STATUS_CATALOG_REF)
        changed = True
    if pop_value(config, "options", None) is not None:
        changed = True
    if prop.pop("options", None) is not None:
        changed = True
    groups = get_value(config, "option_groups")
    if not isinstance(groups, list) or not groups:
        set_value(config, "option_groups", list(DEFAULT_STATUS_GROUPS))
        changed = True
    return changed


def ensure_global_status_catalog(registry: Metadata) -> bool:
    """Merge dedicated status fields into one stable registry catalog."""
    if not isinstance(registry, dict):
        return False
    members = _status_members(registry)
    if not members:
        return False
    root_catalogs = _root_catalogs(registry)
    previous = normalize_options(root_catalogs.get(STATUS_CATALOG_REF))
    merged = _merge_member_options(members, root_catalogs)
    _append_missing(merged, _wanted_statuses(members))
    if registry.get("option_catalogs") is not root_catalogs:
        registry["option_catalogs"] = root_catalogs
    changed = previous != merged
    root_catalogs[STATUS_CATALOG_REF] = merged
    for _, prop in members:
        changed = _configure_status_property(prop) or changed
    return changed


__all__ = ["ensure_global_status_catalog"]
