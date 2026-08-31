"""Vault Resource discovery and filtering for grounded notebooks."""

from __future__ import annotations

import unicodedata
from typing import Any, Iterable, Optional

from fastapi import HTTPException

from backend.domains.notebooks.repository import (
    _bounded_text,
    _connect,
    _normalize_resource_ids,
    authorize,
)
from backend.domains.notebooks.state import (
    _RESOURCE_AUTHOR_FIELD_NAMES,
    _RESOURCE_TYPE_FIELD_NAMES,
)
from backend.domains.vault.registry.records import RecordReader, is_record
from backend.domains.vault.registry.state import RegistryData
from backend.services import llm_wiki_config, llm_wiki_extractors, option_catalogs
from backend.services.workspace_service import WorkspaceContext


def _reference_table() -> tuple[str, dict[str, Any], list[Any]]:
    from backend.domains.vault.citations.export_routes import get_reference_table_id
    from backend.domains.vault.pages.foundation import _get_pages_for_table
    from backend.domains.vault.tables.legacy_composition import _table_by_id

    table_id = str(get_reference_table_id() or "").strip()
    if not table_id:
        raise HTTPException(status_code=409, detail="Configure a References table first.")
    table = _table_by_id(table_id)
    if not table:
        raise HTTPException(
            status_code=409, detail="The configured References table is unavailable."
        )
    return table_id, table, _get_pages_for_table(table_id)


def _selectable_reference_pages(pages: Iterable[Any]) -> list[Any]:
    """Return table records while excluding internal template pages."""
    return [
        page for page in pages if not (getattr(page, "metadata", None) or {}).get("is_template")
    ]


def _alphabetical_key(value: Any) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    return "".join(char for char in normalized if not unicodedata.combining(char)).casefold()


def _field_name_key(value: Any) -> str:
    return "".join(char for char in _alphabetical_key(value) if char.isalnum())


def _resource_filter_properties(table: dict[str, Any]) -> dict[str, RegistryData | None]:
    properties = [prop for prop in table.get("properties") or [] if is_record(prop)]

    def explicit_role(prop: RecordReader) -> str:
        config = prop.get("config")
        return str(config.get("role") or "").strip().casefold() if isinstance(config, dict) else ""

    resource_type = next(
        (
            prop
            for prop in properties
            if explicit_role(prop) in {"type", "item_type", "resource_type"}
        ),
        None,
    )
    if resource_type is None:
        resource_type = next(
            (
                prop
                for prop in properties
                if _field_name_key(prop.get("name")) in _RESOURCE_TYPE_FIELD_NAMES
            ),
            None,
        )

    author = next((prop for prop in properties if prop.get("type") == "autoria"), None)
    if author is None:
        author = next(
            (
                prop
                for prop in properties
                if explicit_role(prop) in {"author", "authors", "authorship"}
            ),
            None,
        )
    if author is None:
        author = next(
            (
                prop
                for prop in properties
                if _field_name_key(prop.get("name")) in _RESOURCE_AUTHOR_FIELD_NAMES
            ),
            None,
        )

    return {
        "type": resource_type,
        "author": author,
        "tag": option_catalogs.find_role_prop(table, option_catalogs.ROLE_TAGS),
    }


def _raw_property_value(metadata: dict[str, Any], prop: RecordReader | None) -> Any:
    if not prop:
        return None
    for key in (str(prop.get("name") or ""), str(prop.get("id") or "")):
        if key and key in metadata and metadata[key] not in (None, "", [], {}):
            return metadata[key]
    return None


def _resource_filter_values(
    metadata: dict[str, Any],
    prop: RecordReader | None,
    *,
    author: bool = False,
) -> list[str]:
    if not prop:
        return []
    if author:
        raw = _raw_property_value(metadata, prop)
        values = raw if isinstance(raw, list) else ([] if raw in (None, "") else [raw])
        labels: list[str] = []
        for value in values:
            if isinstance(value, dict):
                label = " ".join(
                    str(value.get(part) or "").strip()
                    for part in ("nom", "cognom1", "cognom2")
                    if str(value.get(part) or "").strip()
                )
                label = label or str(value.get("name") or value.get("title") or "").strip()
            else:
                label = str(value or "").strip()
            labels.extend(part.strip() for part in label.split(";") if part.strip())
    else:
        labels = llm_wiki_extractors._values_for_property(metadata, prop)  # noqa: SLF001

    unique: dict[str, str] = {}
    for label in labels:
        cleaned = " ".join(str(label or "").split()).strip()
        if cleaned:
            unique.setdefault(cleaned.casefold(), cleaned)
    return list(unique.values())


def _resource_facets(
    rows: list[tuple[Any, dict[str, list[str]]]],
) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    for response_key, value_key in (("types", "type"), ("authors", "author"), ("tags", "tag")):
        counts: dict[str, dict[str, Any]] = {}
        for _resource, values in rows:
            for value in values[value_key]:
                key = value.casefold()
                counts.setdefault(key, {"value": value, "count": 0})["count"] += 1
        result[response_key] = sorted(
            counts.values(),
            key=lambda item: (_alphabetical_key(item["value"]), item["value"]),
        )
    return result


def _source_property_ids(source_config: dict[str, Any]) -> list[str]:
    """Return the configured attachment and URL property identifiers."""
    return [
        *(str(value) for value in source_config.get("attachment_property_ids") or []),
        *(str(value) for value in source_config.get("url_property_ids") or []),
    ]


def _resource_source_count(
    metadata: dict[str, Any],
    table: dict[str, Any],
    source_config: dict[str, Any],
) -> int:
    """Count usable attachment and public HTTP URL cell values for a Resource."""
    props_by_id = {
        str(prop.get("id") or ""): prop
        for prop in table.get("properties") or []
        if isinstance(prop, dict)
    }
    count = 0
    attachment_ids = {str(value) for value in source_config.get("attachment_property_ids") or []}
    for prop_id in _source_property_ids(source_config):
        values = llm_wiki_extractors._values_for_property(  # noqa: SLF001
            metadata,
            props_by_id.get(prop_id),
        )
        if prop_id in attachment_ids:
            count += len(values)
        else:
            count += sum(value.lower().startswith(("http://", "https://")) for value in values)
    return count


def list_reference_resources(
    context: WorkspaceContext,
    *,
    query: str = "",
    page: int = 1,
    page_size: int = 50,
    exclude_notebook_id: Optional[str] = None,
    resource_type: str = "",
    author: str = "",
    tag: str = "",
) -> dict[str, Any]:
    table_id, table, resources = _reference_table()
    resources = _selectable_reference_pages(resources)
    if exclude_notebook_id:
        notebook = authorize(exclude_notebook_id, context, action="manage")
        if notebook["source_table_id"] != table_id:
            raise HTTPException(
                status_code=409,
                detail="This notebook is linked to an earlier References table.",
            )
        with _connect() as connection:
            associated = {
                str(row[0])
                for row in connection.execute(
                    "SELECT resource_id FROM notebook_resources WHERE notebook_id=?",
                    (exclude_notebook_id,),
                ).fetchall()
            }
        resources = [item for item in resources if str(item.id) not in associated]
    source_config = llm_wiki_config.auto_detect_source(table)
    source_config["include_body"] = False
    source_counts = {
        str(resource.id): _resource_source_count(resource.metadata or {}, table, source_config)
        for resource in resources
    }
    hidden_without_sources = sum(count == 0 for count in source_counts.values())
    resources = [resource for resource in resources if source_counts[str(resource.id)] > 0]
    normalized_query = _bounded_text(query, 200).casefold()
    if normalized_query:
        resources = [
            item for item in resources if normalized_query in str(item.title or "").casefold()
        ]
    filter_properties = _resource_filter_properties(table)
    rows = [
        (
            resource,
            {
                "type": _resource_filter_values(resource.metadata, filter_properties["type"]),
                "author": _resource_filter_values(
                    resource.metadata,
                    filter_properties["author"],
                    author=True,
                ),
                "tag": _resource_filter_values(resource.metadata, filter_properties["tag"]),
            },
        )
        for resource in resources
    ]
    facets = _resource_facets(rows)
    selected_filters = {
        "type": _bounded_text(resource_type, 160).casefold(),
        "author": _bounded_text(author, 160).casefold(),
        "tag": _bounded_text(tag, 160).casefold(),
    }
    rows = [
        row
        for row in rows
        if all(
            not selected or selected in {value.casefold() for value in row[1][key]}
            for key, selected in selected_filters.items()
        )
    ]
    rows.sort(
        key=lambda row: (
            _alphabetical_key(row[0].title or row[0].id),
            str(row[0].title or row[0].id).casefold(),
            str(row[0].id),
        )
    )
    page = max(1, int(page))
    page_size = max(1, min(int(page_size), 200))
    total = len(rows)
    selected = rows[(page - 1) * page_size : page * page_size]
    items = []
    for resource, filter_values in selected:
        items.append(
            {
                "id": str(resource.id),
                "title": str(resource.title or resource.id),
                "last_modified": resource.last_modified,
                "source_count": source_counts[str(resource.id)],
                "resource_type": filter_values["type"][0] if filter_values["type"] else None,
                "authors": filter_values["author"],
                "tags": filter_values["tag"],
            }
        )
    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
        "table_id": table_id,
        "source_fields": len(_source_property_ids(source_config)),
        "hidden_without_sources": hidden_without_sources,
        "facets": facets,
    }


def _validate_current_resources(resource_ids: Iterable[Any]) -> tuple[str, list[str]]:
    normalized = _normalize_resource_ids(resource_ids)
    table_id, table, pages = _reference_table()
    source_config = llm_wiki_config.auto_detect_source(table)
    source_config["include_body"] = False
    available = {
        str(page.id)
        for page in _selectable_reference_pages(pages)
        if _resource_source_count(page.metadata or {}, table, source_config) > 0
    }
    missing = [resource_id for resource_id in normalized if resource_id not in available]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{len(missing)} selected Resources do not belong to the configured "
                "References table or have no attachment or URL sources."
            ),
        )
    return table_id, normalized
