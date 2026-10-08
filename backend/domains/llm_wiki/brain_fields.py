"""Read Brain fields through stable roles and immutable property IDs."""

from __future__ import annotations

from backend.domains.vault.registry.records import RecordReader, is_record
from backend.services.field_resolver import get_meta_value
from backend.services.plugin_fields import role_property
from backend.utils.open_values import iterable_values

LEGACY_NAMES = {
    "idea_type": ("Tipus", "Idea type", "Tipus d’idea", "Tipo de idea", "Type d’idée"),
    "position": ("Posició", "Position", "position", "Posición"),
}


def role_id(table: RecordReader, config: RecordReader, role: str) -> str:
    roles = config.get("brain_roles")
    field_id = str(roles.get(role) or "") if is_record(roles) else ""
    if field_id and any(
        is_record(p) and p.get("id") == field_id
        for p in iterable_values(table.get("properties") or [])
    ):
        return field_id
    prop = role_property(table, "llm-wiki", role)
    return str((prop or {}).get("id") or "")


def role_value(
    metadata: RecordReader, table: RecordReader, config: RecordReader, role: str
) -> object:
    field_id = role_id(table, config, role)
    if field_id:
        return get_meta_value(metadata, table, field_id)
    # Compatibility for unbound legacy records; registered roles use only IDs.
    return next(
        (
            metadata.get(name)
            for name in LEGACY_NAMES.get(role, ())
            if metadata.get(name) not in (None, "")
        ),
        None,
    )
