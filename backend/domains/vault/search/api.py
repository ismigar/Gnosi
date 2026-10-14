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
    from backend.domains.vault.links.runtime import _iter_linkable_page_documents
    from backend.domains.vault.pages.foundation import _query_page_title, _resolve_page_context_from_path
    from backend.domains.vault.pages.tags import _page_tags, _table_tag_fields

    resolved_root = root.resolve()
    tag_fields = _table_tag_fields()
    for path, metadata, body, is_dashboard in _iter_linkable_page_documents():
        if is_dashboard:
            continue
        try:
            relative = path.resolve().relative_to(resolved_root)
        except (OSError, ValueError):
            continue
        if any(part.startswith(".") for part in relative.parts) or not path.is_file():
            continue
        _, table_id = _resolve_page_context_from_path(metadata, path)
        search_metadata = {str(key): value for key, value in metadata.items()}
        search_metadata["tags"] = sorted(_page_tags(metadata, tag_fields.get(table_id or "")))
        yield SearchDocument(
            id=str(metadata.get("id") or metadata.get("migration_id") or path.stem),
            title=str(_query_page_title(metadata, path) or path.stem),
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
