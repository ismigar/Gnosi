"""Normalization and migration of managed LLM Wiki page records."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from backend.domains.vault.schemas.pages import PageInfo


Metadata = dict[str, object]
SourceTitles = dict[tuple[str, str], str]


@dataclass(frozen=True)
class BrainRecordDependencies:
    """Schema, page, storage, and note-type ports for Brain record migration."""

    table_by_id: Callable[[str], Metadata | None]
    pages_for_table: Callable[[str], list[PageInfo]]
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    source_title: Callable[[Metadata, Path, Metadata, Metadata], str]
    merge_page_metadata: Callable[[Metadata, str], Metadata]
    prepare_managed_markdown: Callable[[Metadata], Metadata]
    save_page: Callable[[Path, Metadata, str], None]
    register_page: Callable[[Path], None]
    metadata_note_type: Callable[[Metadata], str]
    note_type_value: Callable[[str, Metadata, Metadata | None], object]
    logger: logging.Logger


def _mapping(value: object) -> Metadata:
    return cast(Metadata, value) if isinstance(value, dict) else {}


def _items(value: object) -> list[object]:
    return cast(list[object], value) if isinstance(value, list) else []


def _serialized(metadata: Metadata) -> str:
    return json.dumps(metadata, sort_keys=True, ensure_ascii=False, default=str)


def _properties_by_id(brain_table: Metadata) -> dict[str, Metadata]:
    result: dict[str, Metadata] = {}
    for raw_property in _items(brain_table.get("properties")):
        prop = _mapping(raw_property)
        property_id = str(prop.get("id") or "")
        if property_id:
            result[property_id] = prop
    return result


def _normalize_note_type(
    metadata: Metadata,
    config: Metadata,
    properties: dict[str, Metadata],
    dependencies: BrainRecordDependencies,
) -> tuple[str, str]:
    roles = _mapping(config.get("brain_roles"))
    note_type_property = properties.get(str(roles.get("note_type") or ""))
    note_type_name = str((note_type_property or {}).get("name") or "")
    stored_kind = dependencies.metadata_note_type(metadata)
    managed_role = str(metadata.get("llm_wiki_role") or "")
    semantic_kind = "reading" if stored_kind == "lectura" else stored_kind
    if not semantic_kind and managed_role.endswith("-index"):
        semantic_kind = "index"
    if semantic_kind and note_type_name:
        metadata[note_type_name] = dependencies.note_type_value(
            semantic_kind,
            config,
            note_type_property,
        )
    return stored_kind, semantic_kind


def _source_relations(
    config: Metadata,
    properties: dict[str, Metadata],
) -> tuple[set[str], dict[str, Metadata]]:
    source_names: set[str] = set()
    relations: dict[str, Metadata] = {}
    for raw_source in _items(config.get("source_tables")):
        source = _mapping(raw_source)
        relation = properties.get(str(source.get("relation_property_id") or ""))
        if not relation:
            continue
        relation_name = str(relation.get("name") or "")
        if not relation_name:
            continue
        source_names.add(relation_name)
        source_names.update(
            str(alias) for alias in _items(relation.get("aliases")) if str(alias).strip()
        )
        relations[str(source.get("table_id") or "")] = relation
    return source_names, relations


def _resource_index_title(config: Metadata, source_title: str) -> str:
    locale = str(config.get("ui_locale") or "en").split("-", 1)[0].lower()
    prefix = {
        "ca": "Índex",
        "en": "Index",
        "es": "Índice",
        "fr": "Index",
    }.get(locale, "Index")
    return f"{prefix} · {source_title}"


def _normalize_source_link(
    metadata: Metadata,
    config: Metadata,
    source_titles: SourceTitles,
    relations: dict[str, Metadata],
    semantic_kind: str,
) -> None:
    source_table_id = str(metadata.get("llm_wiki_source_table_id") or "")
    resource_id = str(metadata.get("llm_wiki_resource_id") or "")
    source_title = source_titles.get((source_table_id, resource_id))
    if not source_title or not resource_id:
        return
    metadata["llm_wiki_resource_title"] = source_title
    relation = relations.get(source_table_id)
    managed_role = str(metadata.get("llm_wiki_role") or "")
    if relation and (semantic_kind == "reading" or managed_role == "resource-index"):
        relation_name = str(relation.get("name") or "")
        for alias in _items(relation.get("aliases")):
            metadata.pop(str(alias), None)
        metadata[relation_name] = [f"[[{source_title}|{resource_id}]]"]
    if managed_role == "resource-index":
        metadata["title"] = _resource_index_title(config, source_title)


def normalize_brain_page_contract(
    metadata: Metadata,
    config: Metadata,
    brain_table: Metadata,
    source_titles: SourceTitles,
    dependencies: BrainRecordDependencies,
) -> bool:
    """Normalize visible note types, source cardinality, and source labels."""
    before = _serialized(metadata)
    properties = _properties_by_id(brain_table)
    stored_kind, semantic_kind = _normalize_note_type(
        metadata,
        config,
        properties,
        dependencies,
    )
    source_names, relations = _source_relations(config, properties)
    if stored_kind == "permanent":
        for name in source_names:
            metadata.pop(name, None)
    else:
        _normalize_source_link(
            metadata,
            config,
            source_titles,
            relations,
            semantic_kind,
        )
    return before != _serialized(metadata)


def _source_titles(
    config: Metadata,
    dependencies: BrainRecordDependencies,
) -> SourceTitles:
    result: SourceTitles = {}
    for raw_source in _items(config.get("source_tables")):
        source = _mapping(raw_source)
        source_table_id = str(source.get("table_id") or "")
        source_table = dependencies.table_by_id(source_table_id) or {}
        for page in dependencies.pages_for_table(source_table_id) or []:
            resource_id = str(page.id or "")
            path = Path(page.path) if page.path else None
            metadata = cast(Metadata, page.metadata or {})
            if path and path.exists() and not metadata:
                try:
                    metadata, _body = dependencies.parse_frontmatter(
                        path.read_text(encoding="utf-8"),
                        path,
                    )
                except Exception as error:
                    dependencies.logger.warning(
                        "Could not read source title from %s: %s",
                        path,
                        error,
                    )
            if resource_id and path:
                result[(source_table_id, resource_id)] = dependencies.source_title(
                    metadata,
                    path,
                    source_table,
                    source,
                )
    return result


def _normalize_managed_page(
    page: PageInfo,
    config: Metadata,
    brain_table: Metadata,
    source_titles: SourceTitles,
    dependencies: BrainRecordDependencies,
) -> bool:
    path = Path(page.path) if page.path else None
    if not path or not path.exists():
        return False
    raw_metadata, body = dependencies.parse_frontmatter(
        path.read_text(encoding="utf-8"),
        path,
    )
    page_id = str(page.id or raw_metadata.get("id") or "")
    metadata = dependencies.merge_page_metadata(raw_metadata, page_id)
    contract_changed = normalize_brain_page_contract(
        metadata,
        config,
        brain_table,
        source_titles,
        dependencies,
    )
    portable_metadata = dependencies.prepare_managed_markdown(metadata)
    portable_metadata.pop("note_type", None)
    if not contract_changed and portable_metadata == raw_metadata:
        return False
    dependencies.save_page(path, portable_metadata, body)
    dependencies.register_page(path)
    return True


def normalize_existing_brain_pages(
    brain_table_id: str,
    config: Metadata,
    dependencies: BrainRecordDependencies,
) -> int:
    """Migrate managed notes to the current singular-source contract."""
    brain_table = dependencies.table_by_id(brain_table_id) or {}
    source_titles = _source_titles(config, dependencies)
    migrated = 0
    for page in dependencies.pages_for_table(brain_table_id) or []:
        try:
            if _normalize_managed_page(
                page,
                config,
                brain_table,
                source_titles,
                dependencies,
            ):
                migrated += 1
        except Exception as error:
            dependencies.logger.warning(
                "Could not normalize a managed Brain page in %s: %s",
                page.path,
                error,
            )
    if migrated:
        dependencies.logger.info("LLM Wiki normalized %d existing Brain pages", migrated)
    return migrated


__all__ = [
    "BrainRecordDependencies",
    "Metadata",
    "normalize_brain_page_contract",
    "normalize_existing_brain_pages",
]
