"""Governed adapters for Vault schema discovery and page organization."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

try:
    from langchain_core.tools import tool
except Exception:  # pragma: no cover
    def tool(fn=None, **_kwargs):
        return fn if fn else (lambda function: function)


@tool
def list_vault_tables(limit: int = 100) -> str:
    """List bounded Vault tables and their database associations."""
    from backend.api.vault_routes import load_registry

    registry = load_registry()
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
    from backend.agent.gnosi_tools import _page_files, _parse, _serialize_page, _table

    table = _table(table_id_or_name)
    if not table:
        return json.dumps({"error": "Table not found."})
    table_id = str(table.get("id") or "")
    filters = dict(property_filters or {})
    title_needle = str(title_contains or "").casefold()
    bounded_limit = max(1, min(int(limit), 100))
    results = []
    for path in _page_files():
        try:
            metadata, _body = _parse(path)
        except Exception:
            continue
        current_table = str(
            metadata.get("table_id") or metadata.get("database_table_id") or ""
        )
        if current_table != table_id:
            continue
        title = str(metadata.get("title") or path.stem)
        if title_needle and title_needle not in title.casefold():
            continue
        if any(metadata.get(key) != value for key, value in filters.items()):
            continue
        results.append(_serialize_page(path))
        if len(results) >= bounded_limit:
            break
    return json.dumps({
        "table": {"id": table_id, "name": table.get("name")},
        "rows": results,
    }, ensure_ascii=False, default=str)


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
        register_page_in_index(target)
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
]
VAULT_ADMIN_WRITE_TOOLS = [move_vault_page, rename_vault_page]
