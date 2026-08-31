"""Validation and persistence workflow for LLM Wiki configuration."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import HTTPException

from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData
from backend.services import llm_wiki_config, llm_wiki_indices
from backend.utils.open_values import get_value, iterable_values, set_value


Config = dict[str, object]
Table = RegistryData


@dataclass(frozen=True)
class LlmWikiConfigDependencies:
    """Late-bound facade ports needed to validate and save one configuration."""

    table_by_id: Callable[[str], Table | None]
    infer_brain_roles: Callable[[Table | None], dict[str, str]]
    property_options: Callable[[Table], list[dict[str, str]]]
    ensure_default_db_group: Callable[[], None]
    ensure_brain_schema: Callable[[str, str], int]
    ensure_source_relation: Callable[[str, str, str], str]
    config_response: Callable[[Config], Config]
    source_contract_revision: int


def _properties_by_id(table: Table | None) -> dict[str, Table]:
    return {
        str(prop.get("id") or ""): prop
        for prop in iterable_values((table or {}).get("properties") or [])
        if is_record(prop) and prop.get("id")
    }


def _validate_tables(
    normalized: Config,
    dependencies: LlmWikiConfigDependencies,
) -> tuple[str, Table, list[RegistryData]]:
    brain_id = str(normalized.get("brain_table_id") or "")
    brain = dependencies.table_by_id(brain_id) if brain_id else None
    if not brain_id or not brain:
        raise HTTPException(status_code=400, detail="A valid Brain table is required")
    raw_sources = normalized.get("source_tables")
    if not raw_sources:
        raise HTTPException(status_code=400, detail="At least one source table is required")
    sources = [source for source in iterable_values(raw_sources) if is_record(source)]
    for source in sources:
        source_id = str(source.get("table_id") or "")
        if source_id == brain_id:
            raise HTTPException(
                status_code=400,
                detail="The Brain table cannot also be a source table",
            )
        if not dependencies.table_by_id(source_id):
            raise HTTPException(
                status_code=404,
                detail=f"Source table {source_id} was not found",
            )
    return brain_id, brain, sources


def _eligible_index_ids(
    brain: Table | None,
    excluded_ids: set[str],
) -> set[str]:
    return {
        str(prop.get("id"))
        for prop in llm_wiki_config.eligible_index_properties(
            brain,
            excluded_ids=excluded_ids,
        )
    }


def _validate_index_ids(
    requested_ids: list[str],
    eligible_ids: set[str],
) -> None:
    invalid_ids = [field_id for field_id in requested_ids if field_id not in eligible_ids]
    if invalid_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Non-categorical or reserved index fields: {', '.join(invalid_ids)}",
        )


def _validate_source_fields(
    source_id: str,
    prepared: Config,
    source_properties: dict[str, Table],
) -> None:
    scalar_ids = [
        str(prepared.get("title_property_id") or ""),
        str(prepared.get("language_property_id") or ""),
    ]
    if any(field_id and field_id not in source_properties for field_id in scalar_ids):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid source field in table {source_id}",
        )
    invalid_file_ids = [
        field_id
        for field_id in iterable_values(prepared.get("attachment_property_ids") or [])
        if str(get_value(get_value(source_properties, field_id) or {}, "type") or "").lower()
        not in llm_wiki_config.FILE_TYPES
    ]
    invalid_url_ids = [
        field_id
        for field_id in iterable_values(prepared.get("url_property_ids") or [])
        if str(get_value(get_value(source_properties, field_id) or {}, "type") or "").lower()
        not in llm_wiki_config.URL_TYPES | {"text", "rich_text"}
    ]
    if invalid_file_ids or invalid_url_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid attachment or URL field type in table {source_id}",
        )


def _fixed_values(
    field_id: str,
    mapping: object,
    brain_property: Table,
    dependencies: LlmWikiConfigDependencies,
) -> object:
    canonical = {
        str(item["label"]).strip().casefold(): item["value"]
        for item in dependencies.property_options(brain_property)
    }
    raw_values = get_value(mapping, "fixed_value")
    raw_values = raw_values if isinstance(raw_values, list) else [raw_values]
    values = [
        canonical.get(str(value or "").strip().casefold())
        for value in iterable_values(raw_values)
        if str(value or "").strip()
    ]
    if not values or any(value is None for value in values):
        raise HTTPException(
            status_code=400,
            detail=f"Fixed value for {field_id} must already exist in the Brain field",
        )
    if str(brain_property.get("type") or "") in {"multi_select", "relation"}:
        return values
    return values[0]


def _validate_dimension_mapping(
    *,
    field_id: str,
    source_id: str,
    mapping: object,
    source_properties: dict[str, Table],
    brain_property: Table,
    dependencies: LlmWikiConfigDependencies,
) -> None:
    mode = str(get_value(mapping, "mode") or "ai")
    if mode == "source":
        source_property = source_properties.get(str(get_value(mapping, "source_property_id") or ""))
        if not source_property or not llm_wiki_config._compatible_dimension_types(
            str(source_property.get("type") or ""),
            str(brain_property.get("type") or ""),
        ):
            raise HTTPException(
                status_code=400,
                detail=(f"Incompatible categorical mapping for {field_id} in table {source_id}"),
            )
        if source_property.get("type") == "relation" and str(
            source_property.get("relation_database_id") or ""
        ) != str(brain_property.get("relation_database_id") or ""):
            raise HTTPException(
                status_code=400,
                detail=f"Relation mapping for {field_id} points to a different table",
            )
    elif mode == "fixed":
        fixed = _fixed_values(
            field_id,
            mapping,
            brain_property,
            dependencies,
        )
        set_value(mapping, "fixed_value", fixed)


def _prepare_source(
    source: RegistryData,
    brain: Table,
    requested_index_ids: list[str],
    dependencies: LlmWikiConfigDependencies,
) -> Config:
    source_id = str(source["table_id"])
    source_table = dependencies.table_by_id(source_id) or {}
    source_properties = _properties_by_id(source_table)
    brain_properties = _properties_by_id(brain)
    prepared_raw = llm_wiki_config.auto_detect_source(
        source_table,
        brain,
        requested_index_ids,
        source,
    )
    if not isinstance(prepared_raw, dict):
        raise TypeError("LLM Wiki source auto-detection returned a non-object value")
    prepared: Config = prepared_raw
    _validate_source_fields(source_id, prepared, source_properties)
    mappings = prepared.get("dimension_mappings") or {}
    for field_id in requested_index_ids:
        mapping = get_value(mappings, field_id) or {"mode": "ai"}
        _validate_dimension_mapping(
            field_id=field_id,
            source_id=source_id,
            mapping=mapping,
            source_properties=source_properties,
            brain_property=brain_properties[field_id],
            dependencies=dependencies,
        )
    return prepared


def _validate_before_mutation(
    brain: Table,
    sources: list[RegistryData],
    requested_index_ids: list[str],
    dependencies: LlmWikiConfigDependencies,
) -> None:
    preliminary_roles = dependencies.infer_brain_roles(brain)
    configured_source_ids = {str(source.get("table_id") or "") for source in sources}
    existing_relation_ids = {
        str(get_value(prop, "id") or "")
        for prop in iterable_values(brain.get("properties") or [])
        if get_value(prop, "type") == "relation"
        and str(get_value(prop, "relation_database_id") or "") in configured_source_ids
    }
    note_type_id = str(preliminary_roles.get("note_type") or "")
    _validate_index_ids(
        requested_index_ids,
        _eligible_index_ids(brain, existing_relation_ids | {note_type_id}),
    )


async def put_config(
    payload: object,
    dependencies: LlmWikiConfigDependencies,
) -> Config:
    """Validate, normalize and atomically persist the LLM Wiki configuration."""
    normalized = llm_wiki_config.normalize_config(payload)
    brain_id, brain, sources = _validate_tables(normalized, dependencies)
    requested_index_ids = [str(field_id) for field_id in iterable_values(normalized.get("index_field_ids") or [])]
    _validate_before_mutation(brain, sources, requested_index_ids, dependencies)
    prepared_sources = [
        _prepare_source(source, brain, requested_index_ids, dependencies) for source in sources
    ]

    dependencies.ensure_default_db_group()
    locale = str(normalized.get("ui_locale") or "en")
    dependencies.ensure_brain_schema(brain_id, locale)
    brain_after_schema = dependencies.table_by_id(brain_id)
    normalized["brain_roles"] = dependencies.infer_brain_roles(brain_after_schema)

    relation_ids: set[str] = set()
    for source in prepared_sources:
        source_id = str(source["table_id"])
        relation_id = dependencies.ensure_source_relation(brain_id, source_id, locale)
        source["relation_property_id"] = relation_id
        relation_ids.add(relation_id)
    normalized["source_tables"] = prepared_sources

    brain_after_relations = dependencies.table_by_id(brain_id)
    note_type_id = str(get_value(normalized["brain_roles"], "note_type") or "")
    _validate_index_ids(
        requested_index_ids,
        _eligible_index_ids(brain_after_relations, relation_ids | {note_type_id}),
    )
    normalized["index_field_ids"] = requested_index_ids
    normalized["source_contract_revision"] = dependencies.source_contract_revision
    normalized["configured"] = True
    saved = await asyncio.to_thread(llm_wiki_config.set_full_config, normalized)
    await asyncio.to_thread(llm_wiki_indices.ensure_system_pages, brain_id, saved)
    return await asyncio.to_thread(dependencies.config_response, saved)


__all__ = ["LlmWikiConfigDependencies", "put_config"]
