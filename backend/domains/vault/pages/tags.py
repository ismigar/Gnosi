"""Aggregate portable and semantic table tags across Vault pages."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, TypedDict

from backend.domains.vault.schemas.pages import PageInfo


Metadata = dict[str, Any]
TagField = tuple[str | None, str | None]


class TagPage(TypedDict):
    id: str
    title: str


class TagSummary(TypedDict):
    name: str
    count: int
    pages: list[TagPage]


class TagResponse(TypedDict):
    tags: list[TagSummary]


@dataclass(frozen=True)
class TagQueryDependencies:
    """Ports required to aggregate frontmatter and semantic table tags."""

    page_snapshot: Callable[[], list[PageInfo]]
    load_registry: Callable[[], Metadata]
    find_role_property: Callable[[Metadata, str], Metadata | None]
    tags_role: str
    table_id: Callable[[Metadata], str | None]


_dependencies: TagQueryDependencies | None = None


def configure(dependencies: TagQueryDependencies) -> None:
    """Bind tag-query ports from the application composition root."""
    global _dependencies
    if _dependencies is not None and _dependencies != dependencies:
        raise RuntimeError("Vault tag queries are already configured")
    _dependencies = dependencies


def _deps() -> TagQueryDependencies:
    if _dependencies is None:
        raise RuntimeError("Vault tag queries have not been configured")
    return _dependencies


def extract_tags(raw: object) -> list[str]:
    """Normalize a frontmatter tag list or comma-separated string."""
    if isinstance(raw, str):
        return [tag.strip() for tag in raw.split(",") if tag.strip()]
    if isinstance(raw, list):
        return [str(tag).strip() for tag in raw if str(tag).strip()]
    return []


def _table_tag_fields() -> dict[str, TagField]:
    dependencies = _deps()
    try:
        raw_tables = dependencies.load_registry().get("tables", [])
        tables = raw_tables if isinstance(raw_tables, list) else []
        result: dict[str, TagField] = {}
        for table in tables:
            if not isinstance(table, dict):
                continue
            prop = dependencies.find_role_property(table, dependencies.tags_role)
            if prop and table.get("id"):
                result[str(table["id"])] = (
                    str(prop["id"]) if prop.get("id") else None,
                    str(prop["name"]) if prop.get("name") else None,
                )
        return result
    except Exception:
        return {}


def _page_tags(metadata: Metadata, tag_field: TagField | None) -> set[str]:
    tags = set(extract_tags(metadata.get("tags")))
    if tag_field is None:
        return tags
    field_id, field_name = tag_field
    raw_value = metadata.get(field_id) if field_id else None
    if raw_value is None and field_name:
        raw_value = metadata.get(field_name)
    tags.update(extract_tags(raw_value))
    return tags


def aggregate_tags(pages: list[PageInfo]) -> TagResponse:
    """Build stable tag summaries, deduplicating every page by ID."""
    dependencies = _deps()
    tag_fields = _table_tag_fields()
    tag_map: dict[str, dict[str, str]] = {}
    for page in pages:
        metadata = page.metadata or {}
        if metadata.get("is_template"):
            continue
        table_id = dependencies.table_id(metadata) or ""
        for tag in _page_tags(metadata, tag_fields.get(table_id)):
            tag_map.setdefault(tag, {}).setdefault(page.id, page.title)
    summaries: list[TagSummary] = [
        {
            "name": name,
            "count": len(tag_pages),
            "pages": [{"id": page_id, "title": title} for page_id, title in tag_pages.items()],
        }
        for name, tag_pages in tag_map.items()
    ]
    summaries.sort(key=lambda summary: (-summary["count"], summary["name"].lower()))
    return {"tags": summaries}


async def list_vault_tags() -> TagResponse:
    """Aggregate tags from the current cached Vault page snapshot."""
    pages = await asyncio.to_thread(_deps().page_snapshot)
    return aggregate_tags(pages)


__all__ = [
    "Metadata",
    "TagQueryDependencies",
    "TagResponse",
    "aggregate_tags",
    "configure",
    "extract_tags",
    "list_vault_tags",
]
