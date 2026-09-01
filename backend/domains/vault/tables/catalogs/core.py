"""Option normalization and property-level catalog access."""

from __future__ import annotations

import unicodedata
from backend.domains.vault.registry.records import RecordReader, is_record
from backend.utils.open_values import set_value

from backend.domains.vault.tables.catalogs.types import Metadata, Option

OPTION_TYPES = {"select", "multi_select", "status"}
OPTION_COLOR_PALETTE = [
    "gray",
    "blue",
    "green",
    "yellow",
    "orange",
    "red",
    "purple",
    "pink",
    "brown",
    "teal",
]


def _strip_accents(text: str) -> str:
    return "".join(
        character
        for character in unicodedata.normalize("NFD", text)
        if unicodedata.category(character) != "Mn"
    )


def _norm_name(name: object) -> str:
    return _strip_accents(str(name or "").strip().lower())


def auto_color(name: str) -> str:
    """Return the stable palette color shared with the frontend."""
    color_hash = 5381
    for character in _norm_name(name):
        color_hash = ((color_hash * 33) ^ ord(character)) & 0xFFFFFFFF
    return OPTION_COLOR_PALETTE[color_hash % len(OPTION_COLOR_PALETTE)]


def normalize_option(option: object) -> Option | None:
    """Normalize one legacy scalar or rich option mapping."""
    if isinstance(option, dict):
        name = str(option.get("name") or "").strip()
        if not name:
            return None
        normalized: Option = {"name": name}
        color = str(option.get("color") or "").strip().lower()
        normalized["color"] = color if color in OPTION_COLOR_PALETTE else auto_color(name)
        group = str(option.get("group") or "").strip()
        if group:
            normalized["group"] = group
        return normalized
    if isinstance(option, (str, int, float, bool)):
        name = str(option).strip()
        return {"name": name, "color": auto_color(name)} if name else None
    return None


def normalize_options(options: object) -> list[Option]:
    """Normalize and stably deduplicate an option list by name."""
    normalized: list[Option] = []
    seen: set[str] = set()
    raw_options = options if isinstance(options, list) else []
    for raw_option in raw_options:
        option = normalize_option(raw_option)
        if option and option["name"] not in seen:
            seen.add(str(option["name"]))
            normalized.append(option)
    return normalized


def option_names(options: object) -> list[str]:
    return [str(option["name"]) for option in normalize_options(options)]


def get_prop_config(prop: RecordReader) -> Metadata:
    config = prop.get("config")
    if is_record(config):
        return config
    return {}


def get_prop_options(
    prop: RecordReader,
    option_catalogs: object = None,
) -> list[Option]:
    """Return effective shared, nested or legacy property options."""
    config = get_prop_config(prop)
    reference = str(config.get("catalog_ref") or "").strip()
    if reference and isinstance(option_catalogs, dict):
        shared = option_catalogs.get(reference)
        if isinstance(shared, list):
            return normalize_options(shared)
    nested = config.get("options")
    if isinstance(nested, list):
        return normalize_options(nested)
    legacy = prop.get("options")
    return normalize_options(legacy) if isinstance(legacy, list) else []


def is_global_status_prop(prop: Metadata) -> bool:
    return str(prop.get("type") or "").strip() == "status"


def set_prop_options(prop: Metadata, options: list[Option]) -> None:
    """Write normalized options to their canonical nested location."""
    config = prop.setdefault("config", {})
    set_value(config, "options", normalize_options(options))
    prop.pop("options", None)


__all__ = [
    "OPTION_COLOR_PALETTE",
    "OPTION_TYPES",
    "auto_color",
    "get_prop_config",
    "get_prop_options",
    "is_global_status_prop",
    "normalize_option",
    "normalize_options",
    "option_names",
    "set_prop_options",
]
