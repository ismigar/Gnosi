"""HTTP registration for vault page mutation services."""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from fastapi import APIRouter, BackgroundTasks, Depends

from backend.domains.vault.pages.create_service import (
    CreatePageDependencies,
    create_page as create_page_service,
)
from backend.domains.vault.pages.patch_service import (
    PatchPageDependencies,
    patch_page as patch_page_service,
)
from backend.domains.vault.pages.save_service import (
    SavePageDependencies,
    save_page as save_page_service,
)
from backend.domains.vault.schemas.pages import (
    PageMutationResponse,
    PagePatchRequest,
    PageSaveRequest,
)


class UserContext(Protocol):
    user_id: str


CreateHandler = Callable[
    [PageSaveRequest, BackgroundTasks, UserContext],
    object,
]
SaveHandler = Callable[
    [str, PageSaveRequest, BackgroundTasks, UserContext],
    object,
]
PatchHandler = Callable[
    [str, PagePatchRequest, BackgroundTasks, UserContext],
    object,
]


def register_create_route(
    router: APIRouter,
    *,
    editor_dependency: Callable[..., object],
    workspace_context_dependency: Callable[..., object],
    dependencies: CreatePageDependencies,
) -> CreateHandler:
    """Register create at its historical position and return its handler."""

    async def create_page(
        request: PageSaveRequest,
        background_tasks: BackgroundTasks,
        context: UserContext = Depends(workspace_context_dependency),
    ) -> dict[str, object]:
        """Creates a new page with a UUID ID."""
        return await create_page_service(
            request,
            background_tasks,
            context.user_id,
            dependencies,
        )

    router.add_api_route(
        "/pages",
        create_page,
        methods=["POST"],
        dependencies=[Depends(editor_dependency)],
        response_model=PageMutationResponse,
    )
    return create_page


def register_write_routes(
    router: APIRouter,
    *,
    editor_dependency: Callable[..., object],
    workspace_context_dependency: Callable[..., object],
    save_dependencies: SavePageDependencies,
    patch_dependencies: PatchPageDependencies,
) -> tuple[SaveHandler, PatchHandler]:
    """Register PUT then PATCH at their historical positions."""

    async def save_page(
        page_id: str,
        request: PageSaveRequest,
        background_tasks: BackgroundTasks,
        context: UserContext = Depends(workspace_context_dependency),
    ) -> dict[str, object]:
        """Saves or updates a page existing or re-adapting its UUID."""
        return await save_page_service(
            page_id,
            request,
            background_tasks,
            context.user_id,
            save_dependencies,
        )

    async def patch_page(
        page_id: str,
        request: PagePatchRequest,
        background_tasks: BackgroundTasks,
        context: UserContext = Depends(workspace_context_dependency),
    ) -> dict[str, object]:
        """Partial update of a page (e.g., metadata only)."""
        return await patch_page_service(
            page_id,
            request,
            background_tasks,
            context.user_id,
            patch_dependencies,
        )

    route_dependencies = [Depends(editor_dependency)]
    router.add_api_route(
        "/pages/{page_id}",
        save_page,
        methods=["PUT"],
        dependencies=route_dependencies,
        response_model=PageMutationResponse,
    )
    router.add_api_route(
        "/pages/{page_id}",
        patch_page,
        methods=["PATCH"],
        dependencies=route_dependencies,
        response_model=PageMutationResponse,
    )
    return save_page, patch_page


__all__ = [
    "CreateHandler",
    "PatchHandler",
    "SaveHandler",
    "UserContext",
    "register_create_route",
    "register_write_routes",
]
