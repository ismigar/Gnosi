"""Single, source-scoped section relations and their derived filter ancestry."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from backend.domains.vault.pages.foundation_values import PageMetadata


def section_property(table: Mapping[object, object]) -> PageMetadata | None:
    raw = table.get("properties")
    return next((prop for prop in raw if isinstance(prop, dict)
                 and isinstance(prop.get("config"), dict) and prop["config"].get("source_sections")),
                None) if isinstance(raw, list) else None


def normalize_assignment(metadata: PageMetadata, prop: Mapping[object, object],
                         rows: Sequence[Mapping[object, object]], *, existing_section_id: str = "") -> None:
    field = str(prop.get("name") or "")
    raw = metadata.get(field)
    values = raw if isinstance(raw, list) else [raw] if raw else []
    ids = []
    for value in values:
        if not isinstance(value, str):
            raise ValueError("A source section must be a section identifier")
        match = re.fullmatch(r"\[\[(?:[^|]*\|)?([^\]]+)\]\]", value.strip())
        identifier = match[1] if match else value.strip()
        if identifier:
            ids.append(identifier)
    if len(ids) > 1:
        raise ValueError("A reading note can have only one source section")
    ancestors: list[str] = []
    if ids:
        row = next((row for row in rows if row.get("id") == ids[0]), None)
        if (row is None or (row.get("llm_wiki_section_stale") and ids[0] != existing_section_id)
                or not metadata.get("llm_wiki_resource_id")
                or not metadata.get("llm_wiki_source_table_id")
                or row.get("llm_wiki_resource_id") != metadata.get("llm_wiki_resource_id")
                or row.get("llm_wiki_source_table_id") != metadata.get("llm_wiki_source_table_id")):
            raise ValueError("The section must belong to this note's source")
        raw_ancestors = row.get("llm_wiki_section_ancestor_ids")
        ancestors = [str(value) for value in raw_ancestors] if isinstance(raw_ancestors, list) else []
    metadata[field] = ids
    metadata["llm_wiki_section_field"] = field
    metadata["llm_wiki_section_id"] = ids[0] if ids else ""
    metadata["llm_wiki_section_ancestor_ids"] = ancestors


def validate_source_section_metadata(metadata: PageMetadata, table: Mapping[object, object]) -> None:
    """Validate editor writes using stored source identity and current section rows."""
    prop = section_property(table)
    if prop is None:
        return
    from backend.domains.llm_wiki import legacy_ports
    from backend.services import llm_wiki_storage

    state = llm_wiki_storage.load_page_state(str(metadata.get("id") or ""), metadata)
    for key in ("llm_wiki_resource_id", "llm_wiki_source_table_id"):
        if state.get(key):
            metadata[key] = state[key]
    if not metadata.get("llm_wiki_resource_id") and not metadata.get(str(prop.get("name"))):
        return
    rows = [llm_wiki_storage.page_metadata(page)
            for page in legacy_ports.table_pages(str(prop.get("relation_database_id") or ""))]
    normalize_assignment(metadata, prop, rows,
                         existing_section_id=str(state.get("llm_wiki_section_id") or ""))
