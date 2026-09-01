"""Governed adapters for Vault schema discovery and page organization."""
from __future__ import annotations

import json
import re
import unicodedata
from collections.abc import Callable
from pathlib import Path
from typing import Any, Dict, cast

from langchain_core.tools import tool


@tool
def list_vault_tables(limit: int = 100) -> str:
    """List bounded Vault tables and their database associations."""
    from backend.api.vault_routes import load_registry

    typed_load_registry = cast(Callable[[], dict[str, Any]], load_registry)
    registry = typed_load_registry()
    rows = []
    for table in list(registry.get("tables") or [])[:max(1, min(int(limit), 200))]:
        rows.append({
            "id": str(table.get("id") or ""),
            "name": str(table.get("name") or "")[:300],
            "database_id": str(table.get("database_id") or ""),
            "folder": str(table.get("folder") or table.get("path") or "")[:1_000],
        })
    return json.dumps({"tables": rows}, ensure_ascii=False)


@tool
def read_vault_table_schema(table_id_or_name: str) -> str:
    """Read the bounded schema of one exact Vault table."""
    from backend.agent.gnosi_tools import _bounded_json_value, _table

    table = _table(table_id_or_name)
    if not table:
        return json.dumps({"error": "Table not found."})
    schema = {
        key: value for key, value in table.items()
        if key not in {"rows", "content", "body"}
    }
    return json.dumps(_bounded_json_value(schema), ensure_ascii=False, default=str)


@tool
def query_vault_table(
    table_id_or_name: str,
    property_filters: Dict[str, Any] | None = None,
    title_contains: str = "",
    limit: int = 50,
) -> str:
    """Query one exact Vault table using deterministic equality filters."""
    from backend.agent.gnosi_tools import _bounded_json_value, _table
    from backend.api.vault_routes import (
        _get_pages_for_table,
        _refresh_table_pages_metadata,
    )

    table = _table(table_id_or_name)
    if not table:
        return json.dumps({"error": "Table not found."})
    table_id = str(table.get("id") or "")
    filters = dict(property_filters or {})
    title_needle = str(title_contains or "").casefold()
    bounded_limit = max(1, min(int(limit), 100))
    results = []
    get_pages = cast(Callable[[str], list[Any]], _get_pages_for_table)
    refresh_pages = cast(Callable[[list[Any]], None], _refresh_table_pages_metadata)
    pages = list(get_pages(table_id) or [])
    # The page index normally carries complete frontmatter. A cold or partially
    # reconstructed cache can contain metadata stubs; refresh only this table in
    # the existing bounded worker pool instead of opening every page in the Vault.
    refresh_pages(pages)
    for page in pages:
        metadata = dict(getattr(page, "metadata", None) or {})
        title = str(
            metadata.get("title")
            or getattr(page, "title", "")
            or ""
        )
        if title_needle and title_needle not in title.casefold():
            continue
        if any(
            not _property_filter_matches(metadata.get(key), value)
            for key, value in filters.items()
        ):
            continue
        results.append({
            "id": str(getattr(page, "id", "") or metadata.get("id") or ""),
            "title": title,
            "table_id": table_id,
            "metadata": _bounded_json_value(metadata),
        })
        if len(results) >= bounded_limit:
            break
    return json.dumps({
        "table": {"id": table_id, "name": table.get("name")},
        "rows": results,
    }, ensure_ascii=False, default=str)


def _normalized_identifier(value: Any) -> str:
    """Return accent-insensitive text for stable registry-name matching."""
    decomposed = unicodedata.normalize("NFKD", str(value or ""))
    ascii_text = "".join(
        character
        for character in decomposed
        if not unicodedata.combining(character)
    )
    return re.sub(r"[^a-z0-9]+", " ", ascii_text.casefold()).strip()


def _self_authorship_view(
    table_id: str,
    views: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Resolve a saved first-person authorship view inside one table."""
    exact_names = {
        "soc autor",
        "soc autora",
        "soy autor",
        "soy autora",
        "i am author",
        "i am the author",
        "authored by me",
        "mes ressources",
        "je suis auteur",
        "je suis l auteur",
    }
    candidates = [
        view
        for view in views
        if str(view.get("table_id") or "") == table_id
    ]
    for view in candidates:
        if _normalized_identifier(view.get("name")) in exact_names:
            return view
    return next((
        view
        for view in candidates
        if any(
            _normalized_identifier(item.get("field"))
            in {"autor", "autora", "autoria", "author", "auteur"}
            for item in (view.get("filters") or [])
            if isinstance(item, dict)
        )
        and re.search(
            r"\b(?:soc|soy|my|me|mes|je suis)\b",
            _normalized_identifier(view.get("name")),
        )
    ), None)


@tool
def list_authored_vault_resources(
    offset: int = 0,
    limit: int = 100,
) -> str:
    """List exact resources from the Vault's saved first-person author view.

    Use this for requests about resources authored by the current Vault owner.
    The server resolves the canonical saved view, so callers must not guess an
    author property name or derive a personal identity from model context.
    """
    from backend.agent.agent_context import _table_rows
    from backend.api.vault_routes import load_registry

    typed_load_registry = cast(Callable[[], dict[str, Any]], load_registry)
    typed_table_rows = cast(
        Callable[
            [str, dict[str, str]],
            tuple[list[dict[str, Any]], dict[str, Any] | None],
        ],
        _table_rows,
    )
    registry = typed_load_registry() or {}
    resource_names = {"recursos", "resources", "ressources"}
    table = next((
        item
        for item in (registry.get("tables") or [])
        if _normalized_identifier(item.get("name")) in resource_names
    ), None)
    if not table:
        return json.dumps({
            "error": "The active Vault has no Resources table.",
            "available_tables": [
                {
                    "id": str(item.get("id") or ""),
                    "name": str(item.get("name") or "")[:300],
                }
                for item in (registry.get("tables") or [])[:100]
            ],
        }, ensure_ascii=False)

    table_id = str(table.get("id") or "")
    table_views = [
        item
        for item in (registry.get("views") or [])
        if str(item.get("table_id") or "") == table_id
    ]
    view = _self_authorship_view(table_id, table_views)
    if not view:
        return json.dumps({
            "error": "The Resources table has no saved self-authorship view.",
            "table": {"id": table_id, "name": table.get("name")},
            "available_views": [
                {
                    "id": str(item.get("id") or ""),
                    "name": str(item.get("name") or "")[:300],
                }
                for item in table_views[:100]
            ],
        }, ensure_ascii=False)

    rows, resolved_view = typed_table_rows(
        table_id,
        {"view_id": str(view.get("id") or "")},
    )
    bounded_offset = max(0, min(int(offset), len(rows)))
    bounded_limit = max(1, min(int(limit), 100))
    page = rows[bounded_offset:bounded_offset + bounded_limit]
    records = [
        {
            "id": str(row.get("id") or ""),
            "title": str(row.get("title") or "")[:500],
        }
        for row in page
    ]
    return json.dumps({
        "table": {"id": table_id, "name": table.get("name")},
        "active_view": {
            "id": str((resolved_view or view).get("id") or ""),
            "name": str((resolved_view or view).get("name") or "")[:300],
        },
        "matching_count": len(rows),
        "offset": bounded_offset,
        "limit": bounded_limit,
        "has_more": bounded_offset + len(records) < len(rows),
        "next_offset": (
            bounded_offset + len(records)
            if bounded_offset + len(records) < len(rows)
            else None
        ),
        "records": records,
    }, ensure_ascii=False)


def _normalized_filter_text(value: Any) -> str:
    """Flatten one structured property into stable text for scalar equality."""
    if isinstance(value, dict):
        parts = [_normalized_filter_text(item) for item in value.values()]
    elif isinstance(value, (list, tuple, set)):
        parts = [_normalized_filter_text(item) for item in value]
    elif value is None:
        parts = []
    else:
        parts = [str(value)]
    joined = " ".join(part for part in parts if part)
    normalized = unicodedata.normalize("NFC", joined).casefold()
    return re.sub(r"\s+", " ", normalized).strip()


def _property_filter_matches(actual: Any, expected: Any) -> bool:
    """Apply deterministic equality to scalar and structured table values.

    Relation-like properties are commonly stored as lists of objects. A model
    sees their human-readable values and naturally filters with a scalar such
    as a person's full name, so compare that scalar with each structured item
    after bounded text normalization instead of requiring Python type identity.
    """
    if actual == expected:
        return True
    if isinstance(actual, (list, tuple, set)):
        return any(_property_filter_matches(item, expected) for item in actual)
    if isinstance(expected, str):
        return _normalized_filter_text(actual) == _normalized_filter_text(expected)
    return False


def _relocate_page(
    page_id_or_title: str,
    *,
    folder: str | None = None,
    title: str | None = None,
) -> str:
    from backend.agent.gnosi_tools import _parse, _resolve_page, _vault, _write_page
    from backend.api.vault_routes import register_page_in_index
    from backend.utils.safe_io import sanitize_rel_folder, sanitize_vault_title

    source = _resolve_page(page_id_or_title)
    if source is None:
        return json.dumps({"error": "Page not found."})
    metadata, body = _parse(source)
    target_folder = (
        _vault() / sanitize_rel_folder(folder)
        if folder is not None
        else source.parent
    )
    target_folder.mkdir(parents=True, exist_ok=True)
    target_title = sanitize_vault_title(title or source.stem)
    target = (target_folder / f"{target_title}.md").resolve()
    vault = _vault()
    if vault not in target.parents:
        raise ValueError("Target path is outside the active Vault.")
    if target != source and target.exists():
        raise FileExistsError("A page already exists at the target location.")
    if title is not None:
        metadata["title"] = title
    if target == source:
        if title is not None:
            _write_page(source, metadata, body)
    else:
        _write_page(target, metadata, body)
        source.unlink()
        index_page = cast(Callable[[Path], None], register_page_in_index)
        index_page(target)
    return json.dumps({
        "status": "updated",
        "page_id": str(metadata.get("id") or ""),
        "title": str(metadata.get("title") or target_title),
        "relative_path": target.relative_to(vault).as_posix(),
    }, ensure_ascii=False)


@tool
def move_vault_page(page_id_or_title: str, folder: str) -> str:
    """Move one exact Vault page to a contained folder after an explicit request."""
    return _relocate_page(page_id_or_title, folder=folder)


@tool
def rename_vault_page(page_id_or_title: str, title: str) -> str:
    """Rename one exact Vault page after an explicit request."""
    return _relocate_page(page_id_or_title, title=title)


VAULT_ADMIN_READ_TOOLS = [
    list_vault_tables,
    read_vault_table_schema,
    query_vault_table,
    list_authored_vault_resources,
]
VAULT_ADMIN_WRITE_TOOLS = [move_vault_page, rename_vault_page]
