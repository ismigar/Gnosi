"""Pure, versioned retirement of obsolete Brain field bindings and references."""

from __future__ import annotations

from copy import deepcopy

from backend.domains.llm_wiki.idea_classification import RETIRED_ROLES, processing_owned, properties
from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData
from backend.services.plugin_fields import bindings
from backend.utils.open_values import iterable_values

MIGRATION_VERSION = 1
LEGACY_RETIRED_NAMES = {
    "verification": {
        "Estat de verificació",
        "Verification status",
        "Estado de verificación",
        "État de vérification",
    },
    "last_reviewed": {
        "Última revisió",
        "última revisió",
        "Last reviewed",
        "Última revisión",
        "Dernière révision",
    },
}
REFERENCE_KEYS = frozenset(
    {
        "property",
        "property_id",
        "propertyId",
        "field",
        "field_id",
        "fieldId",
        "column",
        "column_id",
        "columnId",
    }
)


def retired_properties(table: RegistryData, config: RegistryData) -> list[RegistryData]:
    roles = config.get("brain_roles")
    hinted = (
        {str(value) for key, value in roles.items() if key in RETIRED_ROLES}
        if is_record(roles)
        else set()
    )
    found = [
        p
        for p in properties(table)
        if str(bindings(p).get("llm-wiki") or "") in RETIRED_ROLES
        or str(p.get("id") or "") in hinted
    ]
    for prop in found:
        if prop.get("type") not in {"select", "date"} or any(
            plugin != "llm-wiki" for plugin in bindings(prop)
        ):
            raise ValueError("Cannot retire a shared or structurally incompatible Brain property")
        config_value = prop.get("config")
        if prop.get("role") == "status" or (
            is_record(config_value) and config_value.get("role") == "status"
        ):
            raise ValueError("Cannot retire workflow status")
    return found


def metadata_keys(retired: list[RegistryData]) -> set[str]:
    keys: set[str] = set()
    for prop in retired:
        keys.update(
            str(value)
            for value in [
                prop.get("id"),
                prop.get("name"),
                *iterable_values(prop.get("aliases") or []),
            ]
            if value
        )
        role = bindings(prop).get("llm-wiki")
        keys.update(LEGACY_RETIRED_NAMES.get(str(role), set()))
    return keys


def prune_references(value: object, identifiers: set[str], names: set[str]) -> object:
    """Remove field-dependent view clauses; retain unrelated values and ordering."""
    targets = identifiers | names
    if isinstance(value, list):
        return [
            prune_references(item, identifiers, names)
            for item in value
            if not (isinstance(item, str) and item in identifiers)
            and not (
                is_record(item)
                and any(
                    key in REFERENCE_KEYS and isinstance(v, str) and v in targets
                    for key, v in item.items()
                )
            )
        ]
    if is_record(value):
        output: RegistryData = {}
        for key, item in value.items():
            if key in identifiers or (
                key in REFERENCE_KEYS and isinstance(item, str) and item in targets
            ):
                continue
            if (
                key in {"formula", "expression"}
                and isinstance(item, str)
                and any(target in item for target in targets)
            ):
                raise ValueError(
                    "A formula depends on a retired field; rewrite its semantics before migration"
                )
            output[key] = prune_references(item, identifiers, names)
        return output
    return deepcopy(value)


def retire_schema(
    table: RegistryData, config: RegistryData
) -> tuple[RegistryData, RegistryData, set[str]]:
    retired = retired_properties(table, config)
    identifiers = {str(p["id"]) for p in retired}
    names = metadata_keys(retired) - identifiers
    clean = dict(table)
    clean["properties"] = [
        p for p in properties(table) if str(p.get("id") or "") not in identifiers
    ]
    cleaned = prune_references(clean, identifiers, names)
    assert is_record(cleaned)
    result = deepcopy(dict(config))
    roles = result.get("brain_roles")
    result["brain_roles"] = (
        {k: v for k, v in roles.items() if k not in RETIRED_ROLES} if is_record(roles) else {}
    )
    result["index_field_ids"] = [
        v for v in iterable_values(result.get("index_field_ids") or []) if v not in identifiers
    ]
    owned = {str(p.get("id") or "") for p in properties(table) if processing_owned(p)}
    idea_id = result["brain_roles"].get("idea_type") if is_record(result["brain_roles"]) else None
    sources = []
    for original in iterable_values(result.get("source_tables") or []):
        if not is_record(original):
            continue
        source = deepcopy(dict(original))
        assigned = [
            str(v)
            for v in iterable_values(
                source.get("assignment_field_ids", result["index_field_ids"]) or []
            )
            if v not in owned | identifiers
        ]
        if idea_id and idea_id not in assigned:
            assigned.append(str(idea_id))
        source["assignment_field_ids"] = assigned
        mappings = source.get("dimension_mappings")
        source["dimension_mappings"] = (
            {k: v for k, v in mappings.items() if k not in owned | identifiers}
            if is_record(mappings)
            else {}
        )
        sources.append(source)
    result["source_tables"] = sources
    result["note_fields_revision"] = MIGRATION_VERSION
    return dict(cleaned), result, identifiers | names
