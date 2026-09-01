"""Typed rendering for managed LLM Wiki resource and dimension indexes."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol


class UpsertManagedPage(Protocol):
    def __call__(
        self,
        brain_table_id: str,
        title: str,
        role: str,
        managed_key: str,
        content: str,
        extra_metadata: dict[str, Any] | None = None,
        selector: dict[str, Any] | None = None,
    ) -> dict[str, Any]: ...


@dataclass(frozen=True)
class RenderingDependencies:
    """Late-bound compatibility seams used while rendering index pages."""

    metadata: Callable[[Any], dict[str, Any]]
    note_kind: Callable[[Any], str]
    page_wikilink: Callable[[Any], str]
    sortable_integer: Callable[[Any], int]
    title: Callable[[Any], str]
    table: Callable[[str], dict[str, Any] | None]
    set_visible_note_type: Callable[
        [dict[str, Any], dict[str, Any], dict[str, dict[str, Any]], str],
        None,
    ]
    upsert_managed_page: UpsertManagedPage
    wikilink: Callable[[Any, Any], str]
    index_prefix: Callable[[dict[str, Any]], str]
    system_title: Callable[[str, dict[str, Any]], str]
    role_resource_index: str
    role_dimension_index: str
    role_general_index: str


def upsert_resource_index(
    brain_table_id: str,
    source_table_id: str,
    resource_id: str,
    readings: list[Any],
    source_config: dict[str, Any],
    config: dict[str, Any],
    props_by_id: dict[str, dict[str, Any]],
    *,
    dependencies: RenderingDependencies,
) -> dict[str, Any]:
    """Render and persist one ordered resource index."""
    ordered = sorted(readings, key=lambda page: _reading_order(page, dependencies))
    resource_title = next(
        (
            str(dependencies.metadata(page).get("llm_wiki_resource_title") or "")
            for page in ordered
            if dependencies.metadata(page).get("llm_wiki_resource_title")
        ),
        resource_id,
    )
    lines = [
        f"{dependencies.metadata(page).get('Posició') or dependencies.metadata(page).get('position') or '—'}. "
        f"{dependencies.page_wikilink(page)}"
        for page in ordered
    ]
    metadata = _resource_metadata(
        source_table_id,
        resource_id,
        resource_title,
        ordered,
        source_config,
        config,
        props_by_id,
        dependencies,
    )
    return dependencies.upsert_managed_page(
        brain_table_id,
        f"{dependencies.index_prefix(config)} · {resource_title}",
        dependencies.role_resource_index,
        f"resource:{source_table_id}:{resource_id}",
        "\n".join(lines).strip(),
        metadata,
        selector={
            "llm_wiki_source_table_id": source_table_id,
            "llm_wiki_resource_id": resource_id,
        },
    )


def rebuild_dimension_indexes(
    brain_table_id: str,
    prop: dict[str, Any],
    readings: list[Any],
    permanents: list[Any],
    config: dict[str, Any],
    *,
    dependencies: RenderingDependencies,
) -> list[dict[str, Any]]:
    """Render one managed page for each value of a configured dimension."""
    field_name = str(prop.get("name") or prop.get("id") or "")
    field_id = str(prop.get("id") or "")
    grouped = _group_dimension_pages(
        field_name,
        readings,
        permanents,
        dependencies,
    )
    output: list[dict[str, Any]] = []
    ordered_groups = sorted(
        grouped.items(),
        key=lambda pair: _value_label(pair[1]["value"]).casefold(),
    )
    for value_key, item in ordered_groups:
        label = _value_label(item["value"])
        content = _dimension_content(item, dependencies)
        metadata = {field_name: item["value"]}
        props_by_id = _properties_by_id(dependencies.table(brain_table_id) or {})
        dependencies.set_visible_note_type(
            metadata,
            config,
            props_by_id,
            "index",
        )
        output.append(
            dependencies.upsert_managed_page(
                brain_table_id,
                (f"{dependencies.index_prefix(config)} · {field_name}: {label}"),
                dependencies.role_dimension_index,
                f"dimension:{field_id}:{value_key}",
                content,
                metadata,
                selector={
                    "llm_wiki_dimension_field_id": field_id,
                    "llm_wiki_dimension_value_key": value_key,
                },
            )
        )
    return output


def rebuild_general_index(
    brain_table_id: str,
    resource_pages: list[dict[str, Any]],
    dimension_pages: list[dict[str, Any]],
    config: dict[str, Any],
    *,
    dependencies: RenderingDependencies,
) -> None:
    """Render the top-level managed index linking all derived indexes."""
    lines = ["## Field indexes", ""]
    if dimension_pages:
        lines.extend(
            f"- {dependencies.wikilink(page['id'], page['title'])}"
            for page in sorted(
                dimension_pages,
                key=lambda page: str(page["title"]).casefold(),
            )
        )
    else:
        lines.append("_No indexed fields yet._")
    lines.extend(["", "## Processed resources", ""])
    if resource_pages:
        lines.extend(
            f"- {dependencies.wikilink(page['id'], page['title'])}"
            for page in sorted(
                resource_pages,
                key=lambda page: str(page["title"]).casefold(),
            )
        )
    else:
        lines.append("_No processed resources yet._")
    dependencies.upsert_managed_page(
        brain_table_id,
        dependencies.system_title(dependencies.role_general_index, config),
        dependencies.role_general_index,
        "general",
        "\n".join(lines).strip(),
    )


def _resource_metadata(
    source_table_id: str,
    resource_id: str,
    resource_title: str,
    readings: list[Any],
    source_config: dict[str, Any],
    config: dict[str, Any],
    props_by_id: dict[str, dict[str, Any]],
    dependencies: RenderingDependencies,
) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "llm_wiki_source_table_id": source_table_id,
        "llm_wiki_resource_id": resource_id,
        "llm_wiki_resource_title": resource_title,
    }
    raw_field_ids = config.get("index_field_ids") or []
    field_ids = raw_field_ids if isinstance(raw_field_ids, list) else []
    for raw_field_id in field_ids:
        prop = props_by_id.get(str(raw_field_id))
        if not prop:
            continue
        name = str(prop.get("name") or "")
        value = next(
            (
                dependencies.metadata(page).get(name)
                for page in readings
                if dependencies.metadata(page).get(name)
            ),
            None,
        )
        if value not in (None, "", [], {}):
            metadata[name] = value
    relation_prop = props_by_id.get(str(source_config.get("relation_property_id") or ""))
    if relation_prop:
        metadata[str(relation_prop.get("name"))] = [f"[[{resource_title}|{resource_id}]]"]
    dependencies.set_visible_note_type(
        metadata,
        config,
        props_by_id,
        "index",
    )
    return metadata


def _group_dimension_pages(
    field_name: str,
    readings: list[Any],
    permanents: list[Any],
    dependencies: RenderingDependencies,
) -> dict[str, dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for page in [*readings, *permanents]:
        value = dependencies.metadata(page).get(field_name)
        for raw_value in _as_values(value):
            value_key = _value_key(raw_value)
            item = grouped.setdefault(
                value_key,
                {"value": raw_value, "readings": [], "permanents": []},
            )
            bucket = (
                item["readings"]
                if dependencies.note_kind(page) == "lectura"
                else item["permanents"]
            )
            if isinstance(bucket, list):
                bucket.append(page)
    return grouped


def _dimension_content(
    item: dict[str, Any],
    dependencies: RenderingDependencies,
) -> str:
    readings = item.get("readings")
    permanents = item.get("permanents")
    reading_pages = readings if isinstance(readings, list) else []
    permanent_pages = permanents if isinstance(permanents, list) else []
    lines = ["## Reading notes", ""]
    groups: dict[str, list[Any]] = {}
    for page in reading_pages:
        resource = str(dependencies.metadata(page).get("llm_wiki_resource_title") or "No resource")
        groups.setdefault(resource, []).append(page)
    if not groups:
        lines.append("_No reading notes._")
    for resource, pages in sorted(groups.items(), key=lambda pair: pair[0].casefold()):
        lines.extend([f"### {resource}", ""])
        for page in sorted(
            pages,
            key=lambda candidate: _dimension_reading_order(
                candidate,
                dependencies,
            ),
        ):
            lines.append(f"- {dependencies.page_wikilink(page)}")
        lines.append("")
    lines.extend(["## Manual permanent notes", ""])
    if permanent_pages:
        lines.extend(
            f"- {dependencies.page_wikilink(page)}"
            for page in sorted(
                permanent_pages,
                key=lambda page: dependencies.title(page).casefold(),
            )
        )
    else:
        lines.append("_No manual permanent notes._")
    return "\n".join(lines).strip()


def _reading_order(
    page: Any,
    dependencies: RenderingDependencies,
) -> tuple[int, int, str]:
    metadata = dependencies.metadata(page)
    return (
        dependencies.sortable_integer(metadata.get("llm_wiki_origin_order")),
        dependencies.sortable_integer(metadata.get("Posició") or metadata.get("position")),
        dependencies.title(page).casefold(),
    )


def _dimension_reading_order(
    page: Any,
    dependencies: RenderingDependencies,
) -> tuple[int, int]:
    metadata = dependencies.metadata(page)
    return (
        dependencies.sortable_integer(metadata.get("llm_wiki_origin_order")),
        dependencies.sortable_integer(metadata.get("Posició")),
    )


def _properties_by_id(table: dict[str, Any]) -> dict[str, dict[str, Any]]:
    raw_properties = table.get("properties") or []
    return {
        str(prop.get("id") or ""): dict(prop) for prop in raw_properties if isinstance(prop, dict)
    }


def _as_values(value: Any) -> list[Any]:
    if value in (None, "", [], {}):
        return []
    return value if isinstance(value, list) else [value]


def _value_label(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("name") or value.get("title") or value.get("id") or "")
    raw = str(value or "").strip()
    if raw.startswith("[[") and raw.endswith("]]"):
        return raw[2:-2].split("|", 1)[0].strip()
    return raw


def _value_key(value: Any) -> str:
    import hashlib
    import json

    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            default=str,
        ).encode("utf-8")
    ).hexdigest()[:16]


__all__ = [
    "RenderingDependencies",
    "rebuild_dimension_indexes",
    "rebuild_general_index",
    "upsert_resource_index",
]
