"""Semantic role discovery and assignment for table properties."""

from __future__ import annotations

import re
from typing import cast

from backend.domains.vault.tables.catalogs.core import (
    OPTION_TYPES,
    _norm_name,
    get_prop_config,
)
from backend.domains.vault.tables.catalogs.types import Metadata

ROLE_LANGUAGE = "language"
ROLE_STATUS = "status"
ROLE_TAGS = "tags"

ROLE_FIELD_NAMES = {
    ROLE_LANGUAGE: {"idioma", "llengua", "language", "lang", "lengua", "lingua"},
    ROLE_STATUS: {"estat", "estado", "status", "state"},
    ROLE_TAGS: {"tags", "tag", "etiquetes", "etiquetas", "labels"},
}
ROLE_ALLOWED_TYPES = {
    ROLE_LANGUAGE: {"select", "status"},
    ROLE_STATUS: {"select", "status"},
    ROLE_TAGS: {"multi_select"},
}
SOCIAL_COLUMN_RE = re.compile(r"xxss|social", re.IGNORECASE)


def _properties(table: Metadata) -> list[Metadata]:
    raw_properties = table.get("properties") or []
    if not isinstance(raw_properties, list):
        return []
    return [cast(Metadata, prop) for prop in raw_properties if isinstance(prop, dict)]


def prop_role(prop: Metadata) -> str:
    role = str(get_prop_config(prop).get("role") or "").strip().lower()
    return role if role in (ROLE_LANGUAGE, ROLE_STATUS, ROLE_TAGS) else ""


def find_role_prop(table: Metadata, role: str) -> Metadata | None:
    """Find a property by explicit semantic role or legacy name heuristic."""
    properties = _properties(table)
    for prop in properties:
        if prop_role(prop) == role:
            return prop
    names = ROLE_FIELD_NAMES.get(role, set())
    allowed_types = ROLE_ALLOWED_TYPES.get(role, OPTION_TYPES)
    return next(
        (
            prop
            for prop in properties
            if _norm_name(prop.get("name")) in names and prop.get("type") in allowed_types
        ),
        None,
    )


def table_has_social_column(table: Metadata) -> bool:
    for prop in _properties(table):
        config = get_prop_config(prop)
        is_system = prop.get("system") is True or config.get("system") is True
        if is_system and SOCIAL_COLUMN_RE.search(str(prop.get("name") or "")):
            return True
    return False


def _role_allowed_for_property(role: str, prop: Metadata) -> bool:
    property_type = prop.get("type")
    if role == ROLE_TAGS:
        return property_type == "multi_select"
    if role in (ROLE_LANGUAGE, ROLE_STATUS):
        return property_type != "multi_select"
    return True


def assign_roles(table: Metadata) -> bool:
    """Assign missing semantic roles using compatible names and types."""
    properties = _properties(table)
    taken = {role for prop in properties if (role := prop_role(prop))}
    changed = False
    for prop in properties:
        if prop_role(prop) or prop.get("type") not in OPTION_TYPES:
            continue
        name = _norm_name(prop.get("name"))
        for role, names in ROLE_FIELD_NAMES.items():
            if name not in names or role in taken or not _role_allowed_for_property(role, prop):
                continue
            config = prop.setdefault("config", {})
            cast(Metadata, config)["role"] = role
            taken.add(role)
            changed = True
            break
    return changed


__all__ = [
    "ROLE_LANGUAGE",
    "ROLE_STATUS",
    "ROLE_TAGS",
    "assign_roles",
    "find_role_prop",
    "prop_role",
    "table_has_social_column",
]
