"""Idempotent Brain schema and source-relation consolidation."""

from __future__ import annotations

import logging
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData
from backend.utils.open_values import iterable_values


Metadata = RegistryData


@dataclass(frozen=True)
class BrainSchemaDependencies:
    """Registry and compatibility ports for Brain schema maintenance."""

    registry_mutation: Callable[[], AbstractContextManager[None]]
    load_registry: Callable[[], Metadata]
    save_registry: Callable[[Metadata], None]
    schema: Callable[[str], list[tuple[str, str, str]]]
    schema_token: Callable[[object], str]
    role_tokens: Callable[[str], set[str]]
    new_property: Callable[[str, str, str, str], Metadata]
    new_uuid: Callable[[], str]
    source_name: Callable[[str], str]
    source_singular_tokens: frozenset[str]
    source_plural_tokens: frozenset[str]
    migrate_source_metadata: Callable[[object, str, set[str]], int]
    normalize_source_views: Callable[[object, str, str, set[str]], int]
    logger: logging.Logger


def _find_table(registry: Metadata, table_id: object) -> Metadata | None:
    return next(
        (
            table
            for table in iterable_values(registry.get("tables", []) or [])
            if is_record(table) and table.get("id") == table_id
        ),
        None,
    )


def _add_missing_properties(
    table_id: str,
    locale: str,
    properties: list[Metadata],
    dependencies: BrainSchemaDependencies,
) -> int:
    existing = {dependencies.schema_token(prop.get("name")) for prop in properties}
    added = 0
    for role, name, property_type in dependencies.schema(locale):
        if dependencies.role_tokens(role) & existing:
            continue
        properties.append(dependencies.new_property(role, name, property_type, table_id))
        existing.add(dependencies.schema_token(name))
        added += 1
    return added


def _repair_property_ids(
    properties: list[Metadata],
    property_id_hints: dict[str, str],
    dependencies: BrainSchemaDependencies,
) -> int:
    used_ids = {str(prop.get("id") or "") for prop in properties if str(prop.get("id") or "")}
    repaired = 0
    for prop in properties:
        if prop.get("id"):
            continue
        token = dependencies.schema_token(prop.get("name"))
        hinted_id = str(property_id_hints.get(token) or "")
        prop["id"] = (
            hinted_id if hinted_id and hinted_id not in used_ids else dependencies.new_uuid()
        )
        used_ids.add(str(prop["id"]))
        repaired += 1
    return repaired


def _repair_based_on_relations(
    table_id: str,
    properties: list[Metadata],
    dependencies: BrainSchemaDependencies,
) -> int:
    repaired = 0
    based_on_tokens = dependencies.role_tokens("based_on")
    for prop in properties:
        if prop.get("type") != "relation":
            continue
        if dependencies.schema_token(prop.get("name")) not in based_on_tokens:
            continue
        if not prop.get("relation_database_id"):
            prop["relation_database_id"] = table_id
            repaired += 1
        if prop.get("cardinality") != "many-to-many":
            prop["cardinality"] = "many-to-many"
            repaired += 1
    return repaired


def ensure_brain_table_schema(
    table_id: str,
    locale: str,
    property_id_hints: dict[str, str] | None,
    dependencies: BrainSchemaDependencies,
) -> int:
    """Add missing Brain fields and repair stable identifiers idempotently."""
    if not table_id:
        return 0
    with dependencies.registry_mutation():
        registry = dependencies.load_registry()
        table = _find_table(registry, table_id)
        if not table:
            return 0
        raw_properties = table.setdefault("properties", [])
        properties = [prop for prop in iterable_values(raw_properties) if is_record(prop)]
        added = _add_missing_properties(table_id, locale, properties, dependencies)
        repaired = _repair_property_ids(
            properties,
            property_id_hints or {},
            dependencies,
        )
        repaired += _repair_based_on_relations(table_id, properties, dependencies)
        if added or repaired:
            table["properties"] = properties
            dependencies.save_registry(registry)
            dependencies.logger.info(
                "LLM Wiki Brain schema updated: %d fields added and %d properties repaired in %s",
                added,
                repaired,
                table_id,
            )
        return added


def _compatible_relations(
    properties: list[Metadata],
    source_table_id: str,
    dependencies: BrainSchemaDependencies,
) -> list[Metadata]:
    based_on_tokens = dependencies.role_tokens("based_on")
    compatible = [
        prop
        for prop in properties
        if prop.get("type") == "relation"
        and str(prop.get("relation_database_id") or "") == source_table_id
        and dependencies.schema_token(prop.get("name")) not in based_on_tokens
    ]
    compatible.sort(
        key=lambda prop: (
            dependencies.schema_token(prop.get("name")) not in dependencies.source_singular_tokens,
            dependencies.schema_token(prop.get("name")) in dependencies.source_plural_tokens,
        )
    )
    return compatible


def _unique_source_name(
    canonical_name: str,
    source_table: Metadata,
    source_table_id: str,
    properties: list[Metadata],
    canonical: Metadata | None = None,
) -> str:
    used_names = {
        str(prop.get("name") or "").casefold() for prop in properties if prop is not canonical
    }
    if canonical_name.casefold() not in used_names:
        return canonical_name
    base_name = f"{canonical_name} · {source_table.get('name') or source_table_id}"
    name = base_name
    suffix = 2
    while name.casefold() in used_names:
        name = f"{base_name} {suffix}"
        suffix += 1
    return name


def _create_source_relation(
    canonical_name: str,
    source_table: Metadata,
    source_table_id: str,
    properties: list[Metadata],
    dependencies: BrainSchemaDependencies,
) -> Metadata:
    relation: Metadata = {
        "id": dependencies.new_uuid(),
        "name": _unique_source_name(
            canonical_name,
            source_table,
            source_table_id,
            properties,
        ),
        "type": "relation",
        "relation_database_id": source_table_id,
        "cardinality": "many-to-one",
    }
    properties.append(relation)
    return relation


def _normalize_canonical_relation(
    canonical: Metadata,
    canonical_name: str,
    source_table: Metadata,
    source_table_id: str,
    properties: list[Metadata],
    legacy_names: set[str],
    dependencies: BrainSchemaDependencies,
) -> tuple[str, bool]:
    changed = False
    original_name = str(canonical.get("name") or canonical_name)
    if dependencies.schema_token(original_name) in dependencies.source_plural_tokens:
        canonical["name"] = _unique_source_name(
            canonical_name,
            source_table,
            source_table_id,
            properties,
            canonical,
        )
        legacy_names.add(original_name)
        changed = True
    resolved_name = str(canonical.get("name") or canonical_name)
    if not canonical.get("id"):
        canonical["id"] = dependencies.new_uuid()
        changed = True
    if canonical.get("cardinality") != "many-to-one":
        canonical["cardinality"] = "many-to-one"
        changed = True
    return resolved_name, changed


def _merge_duplicates(
    brain: Metadata,
    properties: list[Metadata],
    canonical: Metadata,
    compatible: list[Metadata],
    canonical_name: str,
    legacy_names: set[str],
    source_names: set[str],
) -> bool:
    duplicates = [prop for prop in compatible if prop is not canonical]
    for duplicate in duplicates:
        duplicate_name = str(duplicate.get("name") or "")
        if duplicate_name:
            legacy_names.add(duplicate_name)
            source_names.add(duplicate_name)
    aliases = [
        str(alias)
        for alias in iterable_values(canonical.get("aliases") or [])
        if str(alias).strip() and str(alias) != canonical_name
    ]
    for name in sorted(legacy_names):
        if name and name not in aliases:
            aliases.append(name)
    changed = False
    if aliases != (canonical.get("aliases") or []):
        canonical["aliases"] = aliases
        changed = True
    if duplicates:
        duplicate_ids = {id(prop) for prop in duplicates}
        brain["properties"] = [prop for prop in properties if id(prop) not in duplicate_ids]
        changed = True
    return changed


def ensure_brain_source_relation(
    brain_table_id: object,
    source_table_id: str,
    locale: str,
    dependencies: BrainSchemaDependencies,
) -> str:
    """Consolidate one canonical Brain relation for a configured source table."""
    if not brain_table_id or not source_table_id:
        return ""
    canonical_name = dependencies.source_name(locale)
    legacy_names: set[str] = set()
    source_names = {canonical_name}
    with dependencies.registry_mutation():
        registry = dependencies.load_registry()
        brain = _find_table(registry, brain_table_id)
        source = _find_table(registry, source_table_id)
        if not brain or not source:
            return ""
        raw_properties = brain.setdefault("properties", [])
        properties = [prop for prop in iterable_values(raw_properties) if is_record(prop)]
        compatible = _compatible_relations(properties, source_table_id, dependencies)
        changed = not compatible
        canonical = (
            compatible[0]
            if compatible
            else _create_source_relation(
                canonical_name,
                source,
                source_table_id,
                properties,
                dependencies,
            )
        )
        if not compatible:
            compatible = [canonical]
        canonical_name, normalized = _normalize_canonical_relation(
            canonical,
            canonical_name,
            source,
            source_table_id,
            properties,
            legacy_names,
            dependencies,
        )
        changed = normalized or changed
        source_names.add(canonical_name)
        changed = (
            _merge_duplicates(
                brain,
                properties,
                canonical,
                compatible,
                canonical_name,
                legacy_names,
                source_names,
            )
            or changed
        )
        relation_id = str(canonical.get("id") or "")
        if changed:
            dependencies.save_registry(registry)
            dependencies.logger.info(
                "LLM Wiki consolidated the source relation %s in Brain %s",
                relation_id,
                brain_table_id,
            )
    migrated = dependencies.migrate_source_metadata(
        brain_table_id,
        canonical_name,
        legacy_names,
    )
    if migrated:
        dependencies.logger.info(
            "LLM Wiki migrated %d Brain pages to %s",
            migrated,
            canonical_name,
        )
    dependencies.normalize_source_views(
        brain_table_id,
        source_table_id,
        canonical_name,
        source_names | legacy_names,
    )
    return relation_id


__all__ = [
    "BrainSchemaDependencies",
    "ensure_brain_source_relation",
    "ensure_brain_table_schema",
]
