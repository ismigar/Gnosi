"""Stable, renameable field contracts owned by plugins.

Bindings live beside the property's other configuration. They are server-owned:
an editor may rename a required property, but may not delete it, replace its ID,
change its structural type, or remove the binding through a schema save.
"""

from __future__ import annotations

from fastapi import HTTPException

from backend.domains.vault.registry.records import RecordReader, is_record
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.tables.catalogs.core import get_prop_options
from backend.utils.open_values import iterable_values


def bindings(prop: RegistryData) -> dict[str, str]:
    config = prop.get("config")
    raw = config.get("plugin_roles") if is_record(config) else None
    return {
        str(plugin): str(role)
        for plugin, role in (raw.items() if is_record(raw) else [])
        if plugin and role
    }


def bind(prop: RegistryData, plugin: str, role: str) -> bool:
    """Attach a semantic role without changing the property's ID or name."""
    roles = bindings(prop)
    if roles.get(plugin) == role:
        return False
    roles[plugin] = role
    config = prop.get("config")
    prop["config"] = {**(config if is_record(config) else {}), "plugin_roles": roles}
    return True


def role_property(table: RecordReader, plugin: str, role: str) -> RegistryData | None:
    return next(
        (
            prop
            for prop in iterable_values(table.get("properties") or [])
            if is_record(prop) and bindings(prop).get(plugin) == role
        ),
        None,
    )


def preserve_required_properties(old: RegistryData, incoming: RegistryData) -> None:
    """Validate the complete replacement before any destructive operation."""
    by_id = {
        str(prop.get("id")): prop
        for prop in iterable_values(incoming.get("properties") or [])
        if is_record(prop) and prop.get("id")
    }
    for prop in iterable_values(old.get("properties") or []):
        if not is_record(prop) or not bindings(prop):
            continue
        replacement = by_id.get(str(prop.get("id") or ""))
        if (
            replacement is None
            or replacement.get("type") != prop.get("type")
            or (
                prop.get("type") == "relation"
                and replacement.get("relation_database_id") != prop.get("relation_database_id")
            )
        ):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "plugin_required_field",
                    "field_id": prop.get("id"),
                    "field_name": prop.get("name"),
                    "plugins": sorted(bindings(prop)),
                },
            )
        for plugin, role in bindings(prop).items():
            bind(replacement, plugin, role)
        old_config = prop.get("config") or {}
        semantic_values = old_config.get("plugin_option_values") if is_record(old_config) else None
        if is_record(semantic_values):
            config = replacement.get("config") or {}
            replacement["config"] = {
                **(config if is_record(config) else {}),
                "plugin_option_values": dict(semantic_values),
            }
            names = {option["name"] for option in get_prop_options(replacement)}
            if not set(semantic_values.values()).issubset(names):
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "plugin_required_option",
                        "field_id": prop.get("id"),
                        "plugins": sorted(bindings(prop)),
                    },
                )
