"""Typed LLM Wiki dimension mapping and option normalization."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass


from backend.domains.vault.registry.records import RecordReader
from backend.utils.open_values import iterable_values

TableLookup = Callable[[str], RecordReader | None]
PagesForTable = Callable[[str], Iterable[object]]
CanonicalValue = Callable[[dict[str, object], object, list[dict[str, object]]], object]
DimensionOptions = Callable[
    [dict[str, object], PagesForTable],
    list[dict[str, object]],
]
MetadataValue = Callable[[RecordReader, dict[str, object]], object]


@dataclass(frozen=True)
class DimensionDependencies:
    """Late-bound collaborators retained by the historical service facade."""

    table_by_id: TableLookup
    pages_for_table: PagesForTable
    canonical_value: CanonicalValue
    dimension_options: DimensionOptions
    metadata_value: MetadataValue


def build_dimension_context(
    config: dict[str, object],
    source_table: dict[str, object],
    source_config: dict[str, object],
    metadata: RecordReader,
    *,
    dependencies: DimensionDependencies,
) -> tuple[dict[str, object], list[dict[str, object]]]:
    """Build copied source dimensions and bounded AI classification specs."""
    brain_table = dependencies.table_by_id(str(config.get("brain_table_id") or "")) or {}
    brain_props = _properties_by_id(brain_table)
    source_props = _properties_by_id(source_table)
    mapped: dict[str, object] = {}
    ai_specs: list[dict[str, object]] = []
    raw_mappings = source_config.get("dimension_mappings") or {}
    mappings = raw_mappings if isinstance(raw_mappings, dict) else {}
    raw_field_ids = config.get("index_field_ids") or []
    field_ids = raw_field_ids if isinstance(raw_field_ids, list) else []
    for raw_field_id in field_ids:
        field_id = str(raw_field_id)
        prop = brain_props.get(field_id)
        if not prop:
            continue
        raw_mapping = mappings.get(field_id) or {"mode": "ai"}
        mapping = raw_mapping if isinstance(raw_mapping, dict) else {"mode": "ai"}
        mode = str(mapping.get("mode") or "ai")
        if mode == "empty":
            continue
        options = dependencies.dimension_options(prop, dependencies.pages_for_table)
        if _copy_configured_dimension(
            field_id,
            prop,
            mapping,
            mode,
            options,
            source_props,
            metadata,
            mapped,
            dependencies,
        ):
            continue
        if options:
            ai_specs.append(_ai_spec(field_id, prop, options))
    return mapped, ai_specs


def canonical_dimension_value(
    prop: dict[str, object],
    raw: object,
    options: list[dict[str, object]],
) -> object:
    """Map source/fixed values only to options that already exist."""
    if raw in (None, "", [], {}) or not options:
        return None
    allowed: dict[str, object] = {}
    for option in options:
        for candidate in (
            option.get("label"),
            option.get("value"),
            option.get("id"),
        ):
            key = str(candidate or "").strip().casefold()
            if key:
                allowed[key] = option.get("value")
    candidates = raw if isinstance(raw, list) else [raw]
    mapped: list[object] = []
    for candidate in candidates:
        if isinstance(candidate, dict):
            candidate = (
                candidate.get("name")
                or candidate.get("title")
                or candidate.get("value")
                or candidate.get("id")
            )
        value = allowed.get(str(candidate or "").strip().casefold())
        if value is not None and value not in mapped:
            mapped.append(value)
    if not mapped:
        return None
    return mapped if str(prop.get("type") or "") in {"multi_select", "relation"} else mapped[0]


def dimension_options(
    prop: dict[str, object],
    pages_for_table: PagesForTable,
) -> list[dict[str, object]]:
    """Return canonical select or relation options for one Brain property."""
    prop_type = str(prop.get("type") or "")
    if prop_type == "relation":
        target_id = str(prop.get("relation_database_id") or "")
        if not target_id:
            return []
        return [
            {
                "label": str(getattr(page, "title", "") or ""),
                "value": (f"[[{getattr(page, 'title', '')}|{getattr(page, 'id', '')}]]"),
                "id": str(getattr(page, "id", "") or ""),
            }
            for page in list(pages_for_table(target_id) or [])[:150]
            if getattr(page, "title", None) and getattr(page, "id", None)
        ]
    raw_options = (
        prop.get("options")
        or _mapping(prop.get("config")).get("options")
        or _mapping(prop.get("select")).get("options")
        or []
    )
    output: list[dict[str, object]] = []
    for option in raw_options if isinstance(raw_options, list) else []:
        label = str(option.get("name") if isinstance(option, dict) else option).strip()
        if label:
            output.append({"label": label, "value": label})
    return output


def metadata_property_value(
    metadata: RecordReader,
    prop: dict[str, object],
) -> object:
    """Resolve a source value by visible property name and stable identifier."""
    for key in (str(prop.get("name") or ""), str(prop.get("id") or "")):
        if key and metadata.get(key) not in (None, "", [], {}):
            return metadata.get(key)
    return None


def _copy_configured_dimension(
    field_id: str,
    prop: dict[str, object],
    mapping: dict[str, object],
    mode: str,
    options: list[dict[str, object]],
    source_props: dict[str, dict[str, object]],
    metadata: RecordReader,
    mapped: dict[str, object],
    dependencies: DimensionDependencies,
) -> bool:
    if mode == "fixed":
        value = dependencies.canonical_value(prop, mapping.get("fixed_value"), options)
        if value not in (None, "", [], {}):
            mapped[field_id] = value
        return True
    if mode != "source":
        return False
    source_prop = source_props.get(str(mapping.get("source_property_id") or ""))
    if source_prop:
        value = dependencies.canonical_value(
            prop,
            dependencies.metadata_value(metadata, source_prop),
            options,
        )
        if value not in (None, "", [], {}):
            mapped[field_id] = value
    return True


def _properties_by_id(table: RecordReader) -> dict[str, dict[str, object]]:
    raw_properties = table.get("properties") or []
    return {
        str(prop.get("id") or ""): dict(prop)
        for prop in iterable_values(raw_properties)
        if isinstance(prop, dict) and prop.get("id")
    }


def _ai_spec(
    field_id: str,
    prop: dict[str, object],
    options: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "field_id": field_id,
        "name": str(prop.get("name") or field_id),
        "allowed_labels": [item["label"] for item in options],
        "by_label": {str(item["label"]).casefold(): item["value"] for item in options},
        "multiple": str(prop.get("type") or "") in {"multi_select", "relation"},
    }


def _mapping(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


__all__ = [
    "DimensionDependencies",
    "PagesForTable",
    "build_dimension_context",
    "canonical_dimension_value",
    "dimension_options",
    "metadata_property_value",
]
