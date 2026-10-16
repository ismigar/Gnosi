"""Bookmark operations scoped to the authenticated user's selected vault."""
from __future__ import annotations

import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from backend.services.context_vars import active_vault_path
from backend.services.workspace_service import WorkspaceContext, get_workspace_context
from backend.utils.metadata_io import MetadataUnavailable

from .schemas import (BookmarkCollection, BookmarkEntry, BookmarkId, BookmarkImport, BookmarkItem,
                      BookmarkOrder, BookmarkPage, BookmarkRoute, BookmarkSort, MigrationItem,
                      PageIdentifier, plain_page_route_id)
from .storage import BookmarkStore, State, legacy_item, stable_id


def discover_favorites(context: WorkspaceContext) -> list[BookmarkEntry]:
    """Use the complete server index, hydrating metadata omitted from stubs.

    Incomplete/cloud pages receive no migration receipt until a readable true
    favorite is discovered on a later request. Legacy metadata is never edited.
    """
    from backend.domains.vault.api import pages_queries

    token = active_vault_path.set(context.vault_path)
    try:
        dependencies = pages_queries._deps()
        pages = dependencies.get_pages_snapshot()
        dependencies.refresh_pages_metadata(pages)
        # Hydration can update canonical page identifiers in the index.
        pages = dependencies.get_pages_snapshot()
        favorites: list[BookmarkEntry] = []
        for page in pages:
            if page.metadata.get("favorite") not in (True, "true"):
                continue
            try:
                source_date = getattr(page, "last_modified", None) or getattr(page, "created_time", None)
                try:
                    created_at = datetime.fromisoformat(source_date).timestamp() if source_date else time.time()
                except (TypeError, ValueError, OverflowError):
                    created_at = time.time()
                favorites.append(BookmarkItem(id=stable_id("favorite:" + page.id),
                    label=(page.title or page.id)[:200], group="", kind="page", target=page.id, created_at=created_at))
            except ValidationError:
                # A malformed legacy identifier cannot become a safe route.
                # Leave its metadata intact and retry after the index recovers.
                continue
        return favorites
    finally:
        active_vault_path.reset(token)


def _migrate(store: BookmarkStore, state: State, favorites: list[BookmarkEntry]) -> None:
    migrations = [MigrationItem(source="favorite:" + entry.target, entry=entry,
                               created_at=getattr(entry, "created_at", None))
                  for entry in favorites if "favorite:" + entry.target not in state.sources]
    if migrations:
        store.append(state, migrations=migrations)


def _prepare(context: WorkspaceContext) -> tuple[BookmarkStore, list[BookmarkEntry]]:
    store = BookmarkStore(context)
    try:
        store.guard(store.directory)
        return store, discover_favorites(context)
    except MetadataUnavailable as exc:
        raise HTTPException(503, "Bookmark metadata is still downloading; retry shortly") from exc


def list_bookmarks(context: WorkspaceContext = Depends(get_workspace_context)) -> BookmarkCollection:
    store, favorites = _prepare(context)
    with store.transaction() as state:
        _migrate(store, state, favorites)
        return state.collection()


def put_bookmark(bookmark_id: BookmarkId, request: BookmarkEntry,
                 context: WorkspaceContext = Depends(get_workspace_context)) -> BookmarkCollection:
    if bookmark_id != request.id:
        raise HTTPException(422, "Bookmark path and body identifiers must match")
    store, favorites = _prepare(context)
    with store.transaction() as state:
        _migrate(store, state, favorites)
        return store.append(state, entries=[request])


def delete_bookmark(bookmark_id: BookmarkId,
                    context: WorkspaceContext = Depends(get_workspace_context)) -> BookmarkCollection:
    store, favorites = _prepare(context)
    with store.transaction() as state:
        _migrate(store, state, favorites)
        return store.append(state, deleted=[bookmark_id])


def import_bookmarks(request: BookmarkImport,
                     context: WorkspaceContext = Depends(get_workspace_context)) -> BookmarkCollection:
    store, favorites = _prepare(context)
    with store.transaction() as state:
        # Custom browser labels/groups take precedence over a redundant default
        # favorite imported in this same request.
        migrations = [legacy_item(entry) for entry in request.entries]
        migrations = [item for item in migrations if item.source not in state.sources]
        if migrations:
            store.append(state, migrations=migrations)
        _migrate(store, state, favorites)
        if state.preference is None and (request.sort_mode is not None or request.page_order is not None):
            order = [entry.id for page_id in (request.page_order or [])
                     for entry in state.entries.values() if entry.kind == "page" and entry.target == page_id]
            return store.append(state, order=order, sort_mode=request.sort_mode, preference="legacy")
        return state.collection()


def reorder_bookmarks(request: BookmarkOrder,
                      context: WorkspaceContext = Depends(get_workspace_context)) -> BookmarkCollection:
    store, favorites = _prepare(context)
    with store.transaction() as state:
        _migrate(store, state, favorites)
        return store.append(state, order=request.ids, preference="user")


def sort_bookmarks(request: BookmarkSort,
                   context: WorkspaceContext = Depends(get_workspace_context)) -> BookmarkCollection:
    store, favorites = _prepare(context)
    with store.transaction() as state:
        _migrate(store, state, favorites)
        return store.append(state, sort_mode=request.mode, preference="user")


def toggle_page_bookmark(page_id: PageIdentifier, request: BookmarkPage,
                         context: WorkspaceContext = Depends(get_workspace_context)) -> BookmarkCollection:
    store, favorites = _prepare(context)
    with store.transaction() as state:
        _migrate(store, state, favorites)
        existing = [entry.id for entry in state.entries.values() if entry.kind == "page" and entry.target == page_id]
        entries = []
        if request.enabled:
            # An explicit enable claims the existing aliases as user actions,
            # so a legacy-only tombstone cannot undo this deliberate choice.
            entries = [state.entries[key] for key in existing] if existing else [BookmarkEntry(id=stable_id("page:" + page_id), label=request.label, group="", kind="page", target=page_id)]
        return store.append(state, entries=entries, deleted=existing if not request.enabled else [],
            migrations=[MigrationItem(source="favorite:" + page_id)],
            legacy_page_tombstones=[page_id] if not request.enabled else [])


def toggle_route_bookmark(request: BookmarkRoute,
                          context: WorkspaceContext = Depends(get_workspace_context)) -> BookmarkCollection:
    page_id = plain_page_route_id(request.target)
    if page_id is not None:
        return toggle_page_bookmark(page_id, BookmarkPage(label=request.label, enabled=request.enabled), context)
    store, favorites = _prepare(context)
    with store.transaction() as state:
        _migrate(store, state, favorites)
        existing = [entry.id for entry in state.entries.values()
                    if entry.kind == "route" and entry.target == request.target]
        entries = []
        if request.enabled and not existing:
            entries = [BookmarkEntry(id=stable_id("route:" + request.target), label=request.label,
                                     group="", kind="route", target=request.target)]
        return store.append(state, entries=entries, deleted=existing if not request.enabled else [])


def register_routes(router: APIRouter) -> None:
    router.add_api_route("/bookmarks", list_bookmarks, methods=["GET"], response_model=BookmarkCollection)
    router.add_api_route("/bookmarks/items/{bookmark_id}", put_bookmark, methods=["PUT"], response_model=BookmarkCollection)
    router.add_api_route("/bookmarks/items/{bookmark_id}", delete_bookmark, methods=["DELETE"], response_model=BookmarkCollection)
    router.add_api_route("/bookmarks/import", import_bookmarks, methods=["POST"], response_model=BookmarkCollection)
    router.add_api_route("/bookmarks/reorder", reorder_bookmarks, methods=["POST"], response_model=BookmarkCollection)
    router.add_api_route("/bookmarks/sort", sort_bookmarks, methods=["PUT"], response_model=BookmarkCollection)
    router.add_api_route("/bookmarks/pages/{page_id}", toggle_page_bookmark, methods=["PUT"], response_model=BookmarkCollection)
    router.add_api_route("/bookmarks/route", toggle_route_bookmark, methods=["PUT"], response_model=BookmarkCollection)
