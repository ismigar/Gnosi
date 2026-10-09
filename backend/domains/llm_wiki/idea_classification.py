"""Default idea assignment and provenance for editable reading-note metadata."""

from __future__ import annotations

from backend.domains.llm_wiki.brain_fields import role_id
from backend.domains.llm_wiki.field_catalogs import catalog_value
from backend.domains.vault.registry.records import RecordReader, is_record
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.tables.catalogs.roles import ROLE_STATUS, prop_role
from backend.services.table_system_dates import property_role as system_date_role
from backend.utils.open_values import iterable_values

CLASSIFICATION_VERSION = 1
RETIRED_ROLES = frozenset({"verification", "last_reviewed"})
IDEA_DESCRIPTION = (
    "Classify the function of this note, not the book's topic. Entity: a concrete person, "
    "institution or object. Concept: one idea or proposition. Summary: a condensation of "
    "an argument. Synthesis: an integration of several supported ideas. Use only the "
    "supplied labels; do not force category diversity. Use [] when ambiguous and explain "
    "the classification or abstention in classification_reason."
)


def processing_owned(prop: RecordReader) -> bool:
    """Workflow and system dates cannot be assigned by source processing."""
    config = prop.get("config")
    roles = config.get("plugin_roles") if is_record(config) else None
    return (
        prop_role(prop) == ROLE_STATUS
        or system_date_role(prop) is not None
        or prop.get("type") in {"created_time", "last_edited_time", "created_by", "last_edited_by"}
        or (is_record(roles) and str(roles.get("llm-wiki") or "") in RETIRED_ROLES)
    )


def assignment_ids(config: RecordReader, source: RecordReader, table: RecordReader) -> list[str]:
    selected = source.get("assignment_field_ids")
    ids = [
        str(value)
        for value in iterable_values(
            (config.get("index_field_ids") if selected is None else selected) or []
        )
    ]
    idea = role_id(table, config, "idea_type")
    if idea and idea not in ids:
        ids.append(idea)
    return list(dict.fromkeys(ids))


def properties(table: RecordReader) -> list[RegistryData]:
    return [
        dict(prop) for prop in iterable_values(table.get("properties") or []) if is_record(prop)
    ]


def classification_property(table: RecordReader, config: RecordReader) -> RegistryData | None:
    ident = role_id(table, config, "idea_type")
    return next((p for p in properties(table) if p.get("id") == ident), None)


def legacy_classification(note: RecordReader, prop: RegistryData) -> str | None:
    value = str(note.get("type") or "").strip().lower()
    return (
        catalog_value(prop, value) if value in {"entitat", "concepte", "resum", "síntesi"} else None
    )


def provenance(
    field_id: str, value: object, reason: str, *, method: str = "ai"
) -> dict[str, object]:
    return {
        "version": CLASSIFICATION_VERSION,
        "field_id": field_id,
        "value": value,
        "reason": reason,
        "method": method,
    }
