"""Pure Drupal field and identity mappings for Vault rows."""

from __future__ import annotations

from typing import Any


Metadata = dict[str, Any]
DRUPAL_BODY_REF = "__body__"


def props_by_ref(table: Metadata) -> dict[str, Metadata]:
    """Index table properties by stable ID and display name."""
    result: dict[str, Metadata] = {}
    for raw_prop in table.get("properties") or []:
        if not isinstance(raw_prop, dict):
            continue
        prop = raw_prop
        prop_id = prop.get("id")
        name = prop.get("name")
        if prop_id:
            result[str(prop_id)] = prop
        if name:
            result.setdefault(str(name), prop)
    return result


def find_column(table: Metadata, name: str) -> Metadata | None:
    """Find a property by a case-insensitive display name."""
    target = name.strip().lower()
    for raw_prop in table.get("properties") or []:
        if not isinstance(raw_prop, dict):
            continue
        if str(raw_prop.get("name") or "").strip().lower() == target:
            return raw_prop
    return None


def identity_metadata(
    table: Metadata,
    uuid: object,
    nid: object,
    url: object,
) -> Metadata:
    """Build hidden and visible Drupal identity metadata for one row."""
    result: Metadata = {
        "drupal_uuid": uuid or "",
        "drupal_nid": str(nid) if nid is not None else "",
        "drupal_url": url or "",
    }
    nid_column = find_column(table, "Drupal NID")
    url_column = find_column(table, "Drupal URL")
    if nid_column:
        key = nid_column.get("id") or nid_column["name"]
        result[str(key)] = str(nid) if nid is not None else ""
    if url_column:
        key = url_column.get("id") or url_column["name"]
        result[str(key)] = url or ""
    return result


def read_prop_value(metadata: Metadata, prop: Metadata | None) -> Any:
    """Read a property value using title, stable-ID and name precedence."""
    if not prop:
        return None
    is_title = prop.get("type") == "title" or prop.get("name") == "title"
    keys: list[str] = []
    if is_title:
        keys.append("title")
    if prop.get("id"):
        keys.append(str(prop["id"]))
    if prop.get("name"):
        keys.append(str(prop["name"]))
    for key in keys:
        if key in metadata:
            value = metadata.get(key)
            if value not in (None, "", [], {}):
                return value
    return None


def coerce_scalar(value: object, field_type: str | None) -> object | None:
    """Convert a Gnosi scalar to the corresponding Drupal field type."""
    if value is None:
        return None
    if field_type == "integer":
        if not isinstance(value, (str, bytes, bytearray, int, float)):
            return None
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return None
    if field_type in ("decimal", "float"):
        if not isinstance(value, (str, bytes, bytearray, int, float)):
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    if isinstance(value, list):
        return ", ".join(str(item) for item in value if item not in (None, ""))
    return str(value)


__all__ = [
    "DRUPAL_BODY_REF",
    "Metadata",
    "coerce_scalar",
    "find_column",
    "identity_metadata",
    "props_by_ref",
    "read_prop_value",
]
