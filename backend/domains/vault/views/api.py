"""Saved-view operations backed by the central registry."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException

from backend.domains.vault.registry.names import normalize_registry_table_view_names
from backend.domains.vault.registry.records import is_object_list, is_record
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.schemas.pages import PageInfo
from backend.utils.open_values import iterable_values


@dataclass(frozen=True)
class ViewDependencies:
    load_registry: Callable[[], RegistryData]
    save_registry: Callable[[RegistryData], None]
    registry_mutation: Callable[[], AbstractContextManager[None]]
    sort_key: Callable[[RegistryData], tuple[int, str]]
    pages_snapshot: Callable[[], list[PageInfo]]
    logger: logging.Logger


def _registry_views(registry: RegistryData) -> list[RegistryData]:
    raw_views = registry.get("views", [])
    return [view for view in iterable_values(raw_views) if is_record(view)]


def _involves_table(view: RegistryData, table_id: str) -> bool:
    if view.get("table_id") == table_id:
        return True
    raw_joins = view.get("joins") or []
    joins = raw_joins if is_object_list(raw_joins) else []
    return any(is_record(join) and join.get("tableId") == table_id for join in joins)


async def list_views(
    table_id: str | None,
    dependencies: ViewDependencies,
) -> list[RegistryData]:
    registry = dependencies.load_registry()
    views = _registry_views(registry)
    if table_id:
        views = [view for view in views if _involves_table(view, table_id)]
    output: list[RegistryData] = []
    for source_view in views:
        view = dict(source_view)
        if view.get("cardSize") is None:
            view["cardSize"] = "medium"
        if view.get("galleryPreview") is None:
            view["galleryPreview"] = "cover"
        output.append(view)
    return sorted(output, key=dependencies.sort_key)


async def create_view(
    view: RegistryData,
    dependencies: ViewDependencies,
) -> RegistryData:
    with dependencies.registry_mutation():
        registry = dependencies.load_registry()
        if not view.get("id"):
            view["id"] = str(uuid.uuid4())
        views = _registry_views(registry)
        existing_index = next(
            (index for index, item in enumerate(views) if item["id"] == view["id"]),
            None,
        )
        if existing_index is not None:
            views[existing_index] = view
        else:
            views.append(view)
        registry["views"] = views
        normalize_registry_table_view_names(registry)
        dependencies.save_registry(registry)
    return view


async def reorder_views(
    body: RegistryData,
    dependencies: ViewDependencies,
) -> RegistryData:
    table_id = str(body.get("table_id") or "").strip()
    ordered_ids = body.get("ordered_ids") or []
    if not table_id or not is_object_list(ordered_ids):
        raise HTTPException(
            status_code=422,
            detail="table_id and ordered_ids (list) are required.",
        )
    with dependencies.registry_mutation():
        registry = dependencies.load_registry()
        views = _registry_views(registry)
        table_views = {str(view["id"]): view for view in views if view.get("table_id") == table_id}
        if not table_views:
            raise HTTPException(
                status_code=404,
                detail=f"Table '{table_id}' has no views.",
            )
        other_views, ordered_table_views = _ordered_views(views, table_id, ordered_ids, table_views)
        registry["views"] = other_views + ordered_table_views
        dependencies.save_registry(registry)
    return {
        "ok": True,
        "table_id": table_id,
        "count": len(ordered_table_views),
    }


def _ordered_views(
    views: list[RegistryData],
    table_id: str,
    ordered_ids: list[object],
    table_views: dict[str, RegistryData],
) -> tuple[list[RegistryData], list[RegistryData]]:
    other_views = [view for view in views if view.get("table_id") != table_id]
    seen: set[str] = set()
    ordered: list[RegistryData] = []
    for raw_view_id in ordered_ids:
        view_id = str(raw_view_id)
        view = table_views.get(view_id)
        if view and view_id not in seen:
            ordered.append(view)
            seen.add(view_id)
    ordered.extend(
        view
        for view in views
        if view.get("table_id") == table_id and str(view.get("id")) not in seen
    )
    return other_views, ordered


async def get_view(
    view_id: str,
    dependencies: ViewDependencies,
) -> RegistryData:
    registry = dependencies.load_registry()
    view = next(
        (item for item in _registry_views(registry) if item.get("id") == view_id),
        None,
    )
    if not view:
        raise HTTPException(status_code=404, detail="View not found")
    response = dict(view)
    if response.get("cardSize") is None:
        response["cardSize"] = "medium"
    if response.get("galleryPreview") is None:
        response["galleryPreview"] = "cover"
    return response


async def get_view_usage(
    view_id: str,
    dependencies: ViewDependencies,
) -> RegistryData:
    linked_pages: list[RegistryData] = []
    normalized_view_id = str(view_id).strip()
    for page in dependencies.pages_snapshot() or []:
        path_value = page.path
        if not path_value:
            continue
        path = Path(path_value)
        if not path.exists() or not path.is_file():
            continue
        try:
            content = path.read_text(encoding="utf-8", errors="ignore")
            if normalized_view_id in content:
                linked_pages.append(
                    {
                        "id": page.id or path.stem,
                        "title": page.title or path.stem,
                        "path": str(path),
                    }
                )
        except Exception as error:
            dependencies.logger.warning("Could not check view usage in %s: %s", path, error)
    return {
        "view_id": normalized_view_id,
        "count": len(linked_pages),
        "pages": linked_pages,
    }


async def delete_view(
    view_id: str,
    dependencies: ViewDependencies,
) -> RegistryData:
    with dependencies.registry_mutation():
        registry = dependencies.load_registry()
        views = _registry_views(registry)
        target = next((view for view in views if view.get("id") == view_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="View not found")
        table_id = target.get("table_id")
        siblings = [view for view in views if view.get("table_id") == table_id]
        is_only = len(siblings) <= 1
        is_main = bool(target.get("is_main"))
        other_mains = [
            view for view in siblings if view.get("id") != view_id and view.get("is_main")
        ]
        if is_only:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "cannot_delete_last_view",
                    "message": ("Cannot delete a table's only view. Create another view first."),
                },
            )
        if is_main and not other_mains:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "cannot_delete_main_view",
                    "message": (
                        "Cannot delete the main view. Mark another view as main "
                        "before deleting this one."
                    ),
                },
            )
        registry["views"] = [view for view in views if view.get("id") != view_id]
        dependencies.save_registry(registry)
    return {"status": "success"}


async def update_view(
    view_id: str,
    data: RegistryData,
    dependencies: ViewDependencies,
) -> RegistryData:
    with dependencies.registry_mutation():
        registry = dependencies.load_registry()
        views = _registry_views(registry)
        found = False
        for view in views:
            if view["id"] == view_id:
                view.update(data)
                found = True
                break
        if not found:
            if data.get("id") == view_id:
                views.append(data)
            else:
                raise HTTPException(status_code=404, detail="View not found")
        registry["views"] = views
        normalize_registry_table_view_names(registry)
        dependencies.save_registry(registry)
    return {"status": "success"}


__all__ = [
    "ViewDependencies",
    "create_view",
    "delete_view",
    "get_view",
    "get_view_usage",
    "list_views",
    "reorder_views",
    "update_view",
]
