"""Typed full-text search route under the authenticated Vault router."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from backend.domains.vault.search.query import SearchQueryError
from backend.domains.vault.search.service import SearchDocument, VaultSearchResponse, search_documents
from backend.services.context_vars import get_active_vault_path


def active_documents(root: Path) -> Iterator[SearchDocument]:
    # Reuse the per-Vault parsed-document cache and its mutation invalidation.
    from backend.api.vault_routes import load_registry
    from backend.domains.vault.links.runtime import _iter_linkable_page_documents
    from backend.domains.vault.registry.records import is_record
    from backend.domains.vault.tables.rows import build_table_folder_index, resolve_table_id_from_context
    from backend.services.field_resolver import prepare_response_names
    from backend.utils.open_values import iterable_values
    from backend.domains.vault.pages.tags import _page_tags, _table_tag_fields

    resolved_root = root.resolve()
    tag_fields = _table_tag_fields()
    # Resolve the schema once per request, rather than once per document/title.
    registry = load_registry()
    folder_index = build_table_folder_index(registry)
    sorted_folders = sorted(folder_index, key=len, reverse=True)
    tables = {str(table.get("id")): table for table in iterable_values(registry.get("tables", [])) if is_record(table)}
    names = {key: prepare_response_names(table) for key, table in tables.items()}
    title_fields = {key: [field.get("name") for field in iterable_values(table.get("properties", [])) if is_record(field) and field.get("type") == "title"] for key, table in tables.items()}
    for path, metadata, body, is_dashboard in _iter_linkable_page_documents():
        if is_dashboard:
            continue
        try:
            relative = path.resolve().relative_to(resolved_root)
        except (OSError, ValueError):
            continue
        if any(part.startswith(".") for part in relative.parts) or not path.is_file():
            continue
        table_id = resolve_table_id_from_context(metadata, relative.parent.as_posix(), folder_index, sorted_folders)
        title = metadata.get("title", path.stem)
        if table_id in names:
            named = names[table_id](metadata)
            title = next((named[field] for field in title_fields[table_id] if named.get(field) is not None), title)
        search_metadata = {str(key): value for key, value in metadata.items()}
        search_metadata["tags"] = sorted(_page_tags(metadata, tag_fields.get(table_id or "")))
        yield SearchDocument(
            id=str(metadata.get("id") or metadata.get("migration_id") or path.stem),
            title=str(title or path.stem),
            path=relative.as_posix(), body=body,
            metadata=search_metadata,
        )


def search_vault(
    q: str = Query(min_length=1, max_length=2000),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=100000),
) -> VaultSearchResponse:
    root = get_active_vault_path()
    if root is None:
        raise HTTPException(status_code=404, detail="No active Vault")
    try:
        return search_documents(active_documents(root), q, limit=limit, offset=offset)
    except SearchQueryError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


def register_routes(router: APIRouter) -> None:
    router.add_api_route("/search", search_vault, methods=["GET"], response_model=VaultSearchResponse)
