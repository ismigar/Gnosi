"""System creation and modification date fields for Vault tables.

The schema helpers in this module are deliberately independent from the HTTP
routes so the live migration script and backend writes use the same rules.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional


SYSTEM_DATE_ROLES = ("created", "modified")
SYSTEM_DATE_TYPES = {
    "created": "created_time",
    "modified": "last_edited_time",
}

_LABELS = {
    "ca": {"created": "Data de creació", "modified": "Última modificació"},
    "en": {"created": "Creation date", "modified": "Last modified"},
    "es": {"created": "Fecha de creación", "modified": "Última modificación"},
    "fr": {"created": "Date de création", "modified": "Dernière modification"},
}


def normalize_locale(locale: Any) -> str:
    """Return a supported base locale, defaulting to Catalan."""

    candidate = str(locale or "").strip().replace("_", "-").lower()
    base = candidate.split("-", 1)[0]
    return base if base in _LABELS else "ca"


def system_date_labels(locale: Any = "ca") -> Dict[str, str]:
    """Return localized canonical labels for the two system date roles."""

    return dict(_LABELS[normalize_locale(locale)])


def _normalized_name(value: Any) -> str:
    plain = unicodedata.normalize("NFKD", str(value or ""))
    plain = "".join(char for char in plain if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", "", plain.casefold())


_CREATED_NAMES = {
    _normalized_name(value)
    for value in (
        "Data de creació",
        "Fecha de creación",
        "Date de création",
        "Creation date",
        "Created at",
        "Created",
        "Date Added",
        "Date added",
        "Date created",
        "Creation date",
        "date_added",
        "date_created",
        "created_time",
    )
}
_MODIFIED_NAMES = {
    _normalized_name(value)
    for value in (
        "Última modificació",
        "Última edició",
        "Fecha de modificación",
        "Dernière modification",
        "Date de modification",
        "Last modified",
        "Edited at",
        "Modified",
        "Date Modified",
        "Date modified",
        "Last edited",
        "date_modified",
        "last_modified",
        "last_edited_time",
    )
}


def property_role(prop: Optional[Dict[str, Any]]) -> Optional[str]:
    """Identify a system-date role without treating arbitrary dates as special."""

    if not isinstance(prop, dict):
        return None
    explicit = str(prop.get("system_date_role") or "").strip().lower()
    if explicit in SYSTEM_DATE_ROLES:
        return explicit
    field_type = str(prop.get("type") or "").strip().lower()
    if field_type == "created_time":
        return "created"
    if field_type == "last_edited_time":
        return "modified"
    raw_name = str(prop.get("name") or "").strip().casefold()
    if raw_name in {"created_at", "last_edited_at"}:
        return None
    normalized = _normalized_name(prop.get("name"))
    if normalized in _CREATED_NAMES:
        return "created"
    if normalized in _MODIFIED_NAMES:
        return "modified"
    return None


def _stable_property_id(table_id: Any, role: str) -> str:
    digest = hashlib.sha1(
        f"gnosi:system-date:{table_id}:{role}".encode("utf-8")
    ).hexdigest()[:8]
    return f"fld_{digest}"


def _append_alias(prop: Dict[str, Any], name: Any) -> None:
    old_name = str(name or "").strip()
    current_name = str(prop.get("name") or "").strip()
    if not old_name or old_name == current_name:
        return
    aliases = prop.setdefault("aliases", [])
    if not isinstance(aliases, list):
        aliases = []
        prop["aliases"] = aliases
    if old_name not in aliases:
        aliases.append(old_name)


def ensure_system_date_properties(
    table: Dict[str, Any], locale: Any = "ca"
) -> Dict[str, Dict[str, Any]]:
    """Normalize or create both system date properties in one table.

    The table is mutated in place. The return value describes each canonical
    property and every legacy name/id that was absorbed, which is consumed by
    the migration script and is useful for view-reference updates.
    """

    normalized = deepcopy(table)
    properties = [p for p in normalized.get("properties", []) or [] if isinstance(p, dict)]
    labels = system_date_labels(locale)
    by_role: Dict[str, list[Dict[str, Any]]] = {role: [] for role in SYSTEM_DATE_ROLES}
    for prop in properties:
        role = property_role(prop)
        if role:
            by_role[role].append(prop)

    absorbed: Dict[str, Dict[str, Any]] = {}
    kept: list[Dict[str, Any]] = []
    targets: Dict[str, Dict[str, Any]] = {}
    removed_ids: set[str] = set()
    removed_objects: set[int] = set()
    for role in SYSTEM_DATE_ROLES:
        candidates = by_role[role]
        target = candidates[0] if candidates else None
        if target is None:
            target = {
                "id": _stable_property_id(normalized.get("id"), role),
                "name": labels[role],
                "type": SYSTEM_DATE_TYPES[role],
                "read_only": True,
                "system_date_role": role,
            }
            properties.append(target)
        old_names: list[str] = []
        old_ids: list[str] = []
        original_name = str(target.get("name") or "").strip()
        if original_name and original_name != labels[role]:
            old_names.append(original_name)
            aliases = target.setdefault("aliases", [])
            if not isinstance(aliases, list):
                aliases = []
                target["aliases"] = aliases
            if original_name not in aliases:
                aliases.append(original_name)
        target["name"] = labels[role]
        target["type"] = SYSTEM_DATE_TYPES[role]
        target["read_only"] = True
        target["system_date_role"] = role
        targets[role] = target
        for duplicate in candidates[1:]:
            removed_objects.add(id(duplicate))
            duplicate_name = str(duplicate.get("name") or "").strip()
            duplicate_id = str(duplicate.get("id") or "").strip()
            if duplicate_name:
                old_names.append(duplicate_name)
                _append_alias(target, duplicate_name)
            if duplicate_id:
                old_ids.append(duplicate_id)
                removed_ids.add(duplicate_id)
        absorbed[role] = {
            "name": labels[role],
            "id": target.get("id"),
            "old_names": old_names,
            "old_ids": old_ids,
        }

    for prop in properties:
        if id(prop) not in removed_objects and str(prop.get("id") or "") not in removed_ids:
            kept.append(prop)
    target_objects = {id(prop) for prop in targets.values()}
    normalized["properties"] = [
        prop for prop in kept if id(prop) not in target_objects
    ] + [targets[role] for role in SYSTEM_DATE_ROLES]
    table.clear()
    table.update(normalized)
    return absorbed


def system_date_properties(table: Optional[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Return canonical system date properties keyed by role."""

    found: Dict[str, Dict[str, Any]] = {}
    for prop in (table or {}).get("properties", []) or []:
        role = property_role(prop)
        if role and role not in found:
            found[role] = prop
    return found


def _first_value(metadata: Dict[str, Any], keys: Iterable[str]) -> Any:
    for key in keys:
        if key in metadata and metadata[key] not in (None, "", []):
            return metadata[key]
    return None


def stamp_system_dates(
    metadata: Dict[str, Any],
    table: Optional[Dict[str, Any]],
    *,
    is_create: bool,
    now: Optional[str] = None,
    created_fallback: Optional[str] = None,
) -> Dict[str, Any]:
    """Stamp canonical system-date values and remove absorbed legacy keys."""

    if not isinstance(metadata, dict) or not table:
        return metadata
    props = system_date_properties(table)
    if not props:
        return metadata
    timestamp = now or datetime.now(timezone.utc).isoformat()
    for role, prop in props.items():
        name = str(prop.get("name") or "").strip()
        if not name:
            continue
        aliases = [str(alias).strip() for alias in (prop.get("aliases") or []) if str(alias).strip()]
        current = metadata.get(name)
        if role == "created":
            if current in (None, "", []):
                current = _first_value(metadata, aliases) or created_fallback
                if current in (None, "", []):
                    current = timestamp
                metadata[name] = current
        else:
            metadata[name] = timestamp
        for alias in aliases:
            if alias != name:
                metadata.pop(alias, None)
    return metadata
