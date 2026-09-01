"""Per-table option normalization and feature-aware status seeds."""

from __future__ import annotations

from typing import cast

from backend.domains.vault.tables.catalogs.core import (
    OPTION_TYPES,
    auto_color,
    get_prop_config,
    get_prop_options,
    normalize_options,
    set_prop_options,
)
from backend.domains.vault.tables.catalogs.roles import (
    ROLE_STATUS,
    assign_roles,
    find_role_prop,
    table_has_social_column,
)
from backend.domains.vault.tables.catalogs.types import Metadata, Option, Seed

DEFAULT_STATUS_GROUPS = ["Inicial", "En curs", "Final"]
STATUS_DRAFT = "Esborrany"
STATUS_REVIEWED = "Revisat"
STATUS_TRANSLATED = "Traduït"
STATUS_PUBLISHED_DRUPAL = "Publicat a Drupal"
STATUS_PUBLISHED_SOCIAL = "Publicat a XXSS"
BASE_STATUS_SEED: list[Seed] = [
    (STATUS_DRAFT, "Inicial"),
    (STATUS_REVIEWED, "En curs"),
]
STATUS_CATALOG_REF = "status"


def _properties(table: Metadata) -> list[Metadata]:
    raw_properties = table.get("properties") or []
    if not isinstance(raw_properties, list):
        return []
    return [cast(Metadata, prop) for prop in raw_properties if isinstance(prop, dict)]


def ensure_options_exist(prop: Metadata, wanted: list[Seed]) -> bool:
    """Normalize a local catalog and append missing seeded values."""
    config = get_prop_config(prop)
    if str(config.get("catalog_ref") or "").strip():
        return False
    existing = get_prop_options(prop)
    before = [dict(option) for option in existing]
    names = {str(option["name"]) for option in existing}
    for name, group in wanted:
        if name in names:
            continue
        option: Option = {"name": name, "color": auto_color(name)}
        if group:
            option["group"] = group
        existing.append(option)
        names.add(name)
    raw_options = config.get("options") or prop.get("options")
    requires_normalization = (
        raw_options is not None and normalize_options(raw_options) != raw_options
    )
    if existing == before and not requires_normalization and not (raw_options is None and existing):
        return False
    set_prop_options(prop, existing)
    return True


def _wanted_statuses(table: Metadata) -> list[Seed]:
    wanted = list(BASE_STATUS_SEED)
    if table.get("translation_enabled"):
        wanted.append((STATUS_TRANSLATED, "En curs"))
    if table.get("drupal_sync_enabled"):
        wanted.append((STATUS_PUBLISHED_DRUPAL, "Final"))
    if table_has_social_column(table):
        wanted.append((STATUS_PUBLISHED_SOCIAL, "Final"))
    return wanted


def _ensure_status_groups(prop: Metadata) -> bool:
    if prop.get("type") != "status":
        return False
    config = cast(Metadata, prop.setdefault("config", {}))
    groups = config.get("option_groups")
    if isinstance(groups, list) and groups:
        return False
    config["option_groups"] = list(DEFAULT_STATUS_GROUPS)
    return True


def ensure_status_seed(table: Metadata) -> bool:
    """Seed the table's semantic status field for enabled features."""
    prop = find_role_prop(table, ROLE_STATUS)
    if not prop:
        return False
    changed = ensure_options_exist(prop, _wanted_statuses(table))
    return _ensure_status_groups(prop) or changed


def _normalize_property_options(prop: Metadata) -> bool:
    if prop.get("type") not in OPTION_TYPES:
        return False
    config = get_prop_config(prop)
    if str(config.get("catalog_ref") or "").strip():
        changed = config.get("options") is not None or prop.get("options") is not None
        config.pop("options", None)
        prop.pop("options", None)
        return changed
    raw_options = (
        config.get("options") if isinstance(config.get("options"), list) else prop.get("options")
    )
    if raw_options is None:
        return False
    normalized = normalize_options(raw_options)
    if raw_options == normalized and "options" not in prop:
        return False
    set_prop_options(prop, normalized)
    return True


def normalize_table_options(table: Metadata) -> bool:
    """Canonicalize every selectable property catalog in one table."""
    changed = False
    for prop in _properties(table):
        changed = _normalize_property_options(prop) or changed
    return changed


def ensure_table_seeds(table: Metadata) -> bool:
    changed = normalize_table_options(table)
    changed = assign_roles(table) or changed
    return ensure_status_seed(table) or changed


__all__ = [
    "BASE_STATUS_SEED",
    "DEFAULT_STATUS_GROUPS",
    "STATUS_CATALOG_REF",
    "STATUS_DRAFT",
    "STATUS_PUBLISHED_DRUPAL",
    "STATUS_PUBLISHED_SOCIAL",
    "STATUS_REVIEWED",
    "STATUS_TRANSLATED",
    "ensure_options_exist",
    "ensure_status_seed",
    "ensure_table_seeds",
    "normalize_table_options",
]
