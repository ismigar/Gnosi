"""Vault read and explicit-write tools."""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any, Dict, List, Optional, TypeVar, cast

from backend.domains.agent.gnosi_mutation import _mutate_page, _page_lock
from backend.domains.agent.gnosi_support import (
    _bounded_limit,
    _confirmation,
    _file_revision,
    _json,
    _page_files,
    _parse,
    _resolve_page,
    _serialize_page,
    _table,
    _table_folder,
    _vault,
    _write_page,
)
from backend.utils.safe_io import sanitize_rel_folder, sanitize_vault_title

_F = TypeVar("_F", bound=Callable[..., Any])
_runtime_tool: Any
try:
    from langchain_core.tools import tool as imported_tool

    _runtime_tool = imported_tool
except Exception:  # pragma: no cover
    _runtime_tool = None


def _typed_tool(function: _F) -> _F:
    return function if _runtime_tool is None else cast(_F, _runtime_tool(function))


@_typed_tool
def list_table_rows(table_id_or_name: str, limit: int = 100) -> str:
    """Lists up to 100 rows from a Gnosi table, including row ids and properties.

    Batch edits must inspect the complete bounded result before selecting rows;
    callers must not lower the limit when resolving an "all matching rows"
    request.
    """
    table = _table(table_id_or_name)
    if not table:
        return _json({"error": "Table not found."})
    table_id = str(table.get("id") or "")
    rows = []
    # Batch title-replacement requests must not be reduced to a model-selected
    # sample such as `limit=2`; the caller can still receive at most the safe
    # bounded maximum while resolving all matching rows.
    effective_limit = max(_bounded_limit(limit), 100)
    for path in _page_files():
        try:
            page = _serialize_page(path)
        except Exception:
            continue
        if page["table_id"] == table_id:
            rows.append(page)
        if len(rows) >= effective_limit:
            break
    return _json({"table": {"id": table_id, "name": table.get("name")}, "rows": rows})


@_typed_tool
def get_table_row(row_id_or_title: str) -> str:
    """Gets one table row with its complete properties and bounded page content."""
    path = _resolve_page(row_id_or_title)
    if not path:
        return _json({"error": "Row not found."})
    page = _serialize_page(path, include_body=True)
    if not page["table_id"]:
        return _json({"error": "The page is not a table row."})
    return _json(page)


@_typed_tool
def list_tags(limit: int = 100) -> str:
    """Lists tags used by Vault pages with usage counts."""
    counts: Dict[str, int] = {}
    for path in _page_files():
        try:
            metadata, _body = _parse(path)
        except Exception:
            continue
        tags = metadata.get("tags") or []
        if isinstance(tags, str):
            tags = [item.strip() for item in re.split(r"[,;]", tags)]
        for tag in tags:
            clean = str(tag).strip().lstrip("#")
            if clean:
                counts[clean] = counts.get(clean, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0].casefold()))
    return _json([{"tag": tag, "count": count} for tag, count in ranked[: _bounded_limit(limit)]])


@_typed_tool
def find_pages_by_tag(tag: str, limit: int = 50) -> str:
    """Finds bounded Vault pages carrying an exact tag."""
    needle = str(tag or "").strip().lstrip("#").casefold()
    pages = []
    for path in _page_files():
        try:
            metadata, _body = _parse(path)
        except Exception:
            continue
        tags = metadata.get("tags") or []
        if isinstance(tags, str):
            tags = re.split(r"[,;]", tags)
        if needle in {str(item).strip().lstrip("#").casefold() for item in tags}:
            pages.append(_serialize_page(path))
        if len(pages) >= _bounded_limit(limit):
            break
    return _json(pages)


@_typed_tool
def get_page_links(page_id_or_title: str, limit: int = 50) -> str:
    """Returns bounded outgoing links, backlinks, and unlinked title mentions."""
    target = _resolve_page(page_id_or_title)
    if not target:
        return _json({"error": "Page not found."})
    metadata, body = _parse(target)
    target_id = str(metadata.get("id") or "")
    title = str(metadata.get("title") or target.stem)
    outgoing = re.findall(r"\[\[([^\]|#]+)", body)
    backlinks: List[Dict[str, str]] = []
    mentions: List[Dict[str, str]] = []
    link_pattern = re.compile(r"\[\[([^\]|#]+)", re.IGNORECASE)
    title_pattern = re.compile(rf"(?<![\w[])({re.escape(title)})(?![\w\]])", re.IGNORECASE)
    for path in _page_files():
        if path == target:
            continue
        try:
            source_meta, source_body = _parse(path)
        except Exception:
            continue
        refs = {item.strip().casefold() for item in link_pattern.findall(source_body)}
        source = {
            "id": str(source_meta.get("id") or ""),
            "title": str(source_meta.get("title") or path.stem),
        }
        if title.casefold() in refs or (target_id and target_id.casefold() in refs):
            backlinks.append(source)
        elif title_pattern.search(source_body):
            mentions.append(source)
        if len(backlinks) + len(mentions) >= _bounded_limit(limit):
            break
    return _json(
        {
            "outgoing": outgoing[: _bounded_limit(limit)],
            "backlinks": backlinks[: _bounded_limit(limit)],
            "unlinked_mentions": mentions[: _bounded_limit(limit)],
        }
    )


@_typed_tool
def get_page_history(page_id_or_title: str, limit: int = 20) -> str:
    """Lists available saved versions of a Vault page without restoring them."""
    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})
    metadata, _body = _parse(path)
    page_id = str(metadata.get("id") or "")
    history = _vault() / ".history" / page_id
    versions = []
    if history.exists():
        for version in sorted(history.glob("*.md"), reverse=True)[: _bounded_limit(limit)]:
            versions.append(
                {
                    "timestamp": version.stem,
                    "size": version.stat().st_size,
                }
            )
    return _json({"page_id": page_id, "versions": versions})


@_typed_tool
def create_table_row(
    table_id_or_name: str,
    title: str,
    properties: Optional[Dict[str, Any]] = None,
    content: str = "",
) -> str:
    """Creates a row in a Gnosi table. Use only after an explicit user request."""
    import uuid

    table = _table(table_id_or_name)
    if not table:
        return _json({"error": "Table not found."})
    table_id = str(table.get("id") or "")
    page_id = str(uuid.uuid4())
    metadata = dict(properties or {})
    metadata.update(
        {
            "id": page_id,
            "title": title,
            "table_id": table_id,
            "database_table_id": table_id,
        }
    )
    folder = sanitize_rel_folder(_table_folder(table), fallback="Databases")
    destination = (_vault() / folder).resolve()
    vault = _vault()
    if destination != vault and vault not in destination.parents:
        return _json({"error": "The table folder is outside the active Vault."})
    destination.mkdir(parents=True, exist_ok=True)
    safe_title = sanitize_vault_title(title)
    path = destination / f"{safe_title}.md"
    with _page_lock(path):
        if path.exists():
            path = destination / f"{safe_title} {page_id[:8]}.md"
        _write_page(path, metadata, content)
    return _json({"status": "created", "id": page_id, "title": title, "table_id": table_id})


@_typed_tool
def update_page(
    page_id_or_title: str,
    content: Optional[str] = None,
    properties: Optional[Dict[str, Any]] = None,
) -> str:
    """Updates page content and/or merges properties after an explicit user request."""
    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})

    def mutate(metadata: Dict[str, Any], old_body: str) -> tuple[Dict[str, Any], str]:
        for key, value in (properties or {}).items():
            if key != "id":
                metadata[key] = value
        return metadata, old_body if content is None else content

    metadata = _mutate_page(path, mutate)
    return _json({"status": "updated", "id": metadata.get("id"), "title": metadata.get("title")})


@_typed_tool
def append_to_page(page_id_or_title: str, content: str) -> str:
    """Appends content to a Vault page after an explicit user request."""
    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})

    def mutate(metadata: Dict[str, Any], body: str) -> tuple[Dict[str, Any], str]:
        separator = "\n\n" if body.strip() else ""
        return metadata, f"{body.rstrip()}{separator}{content.strip()}"

    metadata = _mutate_page(path, mutate)
    return _json({"status": "appended", "id": metadata.get("id"), "title": metadata.get("title")})


@_typed_tool
def update_table_row(row_id_or_title: str, properties: Dict[str, Any]) -> str:
    """Merges properties into a table row while preserving unknown metadata."""
    path = _resolve_page(row_id_or_title)
    if not path:
        return _json({"error": "Row not found."})

    def mutate(metadata: Dict[str, Any], body: str) -> tuple[Dict[str, Any], str]:
        if not (metadata.get("table_id") or metadata.get("database_table_id")):
            raise ValueError("The page is not a table row.")
        for key, value in properties.items():
            if key not in {"id", "table_id", "database_table_id"}:
                metadata[key] = value
        return metadata, body

    try:
        metadata = _mutate_page(path, mutate)
    except ValueError as error:
        return _json({"error": str(error)})
    return _json({"status": "updated", "id": metadata.get("id")})


@_typed_tool
def add_tags(page_id_or_title: str, tags: List[str]) -> str:
    """Adds tags to a page without removing existing tags."""
    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})

    def mutate(metadata: Dict[str, Any], body: str) -> tuple[Dict[str, Any], str]:
        current = metadata.get("tags") or []
        if isinstance(current, str):
            current = re.split(r"[,;]", current)
        merged = {str(item).strip().lstrip("#") for item in [*current, *tags] if str(item).strip()}
        metadata["tags"] = sorted(merged, key=str.casefold)
        return metadata, body

    metadata = _mutate_page(path, mutate)
    return _json({"status": "updated", "tags": metadata["tags"]})


@_typed_tool
def add_page_comment(page_id_or_title: str, comment: str) -> str:
    """Adds a timestamped agent comment to a page's metadata."""
    from datetime import datetime, timezone

    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})

    def mutate(metadata: Dict[str, Any], body: str) -> tuple[Dict[str, Any], str]:
        comments = metadata.get("comments") or []
        if not isinstance(comments, list):
            comments = []
        comments.append(
            {
                "author": "agent",
                "content": comment.strip(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        metadata["comments"] = comments
        return metadata, body

    metadata = _mutate_page(path, mutate)
    comments = metadata["comments"]
    return _json({"status": "created", "comment_count": len(comments)})


@_typed_tool
def mark_task_complete(row_id_or_title: str) -> str:
    """Marks a task page or table row complete, preserving all other properties."""
    path = _resolve_page(row_id_or_title)
    if not path:
        return _json({"error": "Task not found."})

    def mutate(metadata: Dict[str, Any], body: str) -> tuple[Dict[str, Any], str]:
        metadata["completed"] = True
        if "status" in metadata:
            metadata["status"] = "done"
        return metadata, body

    metadata = _mutate_page(path, mutate)
    return _json({"status": "completed", "id": metadata.get("id")})


@_typed_tool
def delete_page(page_id_or_title: str) -> str:
    """Prepares moving a page to trash and waits for interactive confirmation."""
    path = _resolve_page(page_id_or_title)
    if not path:
        return _json({"error": "Page not found."})
    metadata, _body = _parse(path)
    page_id = str(metadata.get("id") or "")
    title = str(metadata.get("title") or path.stem)
    return _confirmation(
        "delete_page",
        {
            "page_id": page_id,
            "page_revision": _file_revision(path),
        },
        {
            "page": title,
            "page_id": page_id,
            "page_revision": _file_revision(path),
        },
    )


READ_TOOLS: List[Any] = [
    list_table_rows,
    get_table_row,
    list_tags,
    find_pages_by_tag,
    get_page_links,
    get_page_history,
]


EXPLICIT_WRITE_TOOLS: List[Any] = [
    create_table_row,
    update_page,
    append_to_page,
    update_table_row,
    add_tags,
    add_page_comment,
    mark_task_complete,
]


CONFIRMED_WRITE_TOOLS: List[Any] = [delete_page]
