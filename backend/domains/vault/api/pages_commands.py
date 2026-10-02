"""HTTP registration for vault page mutation services."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Annotated, Protocol

from fastapi import APIRouter, BackgroundTasks, Depends, Header

from backend.domains.vault.pages.creation_requests import create_page_with_receipt, get_creation_status
from backend.domains.vault.pages.creation_recovery import recover_page_creation, recovery_access_guard

from backend.domains.vault.pages.create_service import (
    CreatePageDependencies,
)
from backend.domains.vault.pages.create_service import (
    create_page as create_page_service,
)
from backend.domains.vault.pages.patch_service import (
    PatchPageDependencies,
)
from backend.domains.vault.pages.patch_service import (
    patch_page as patch_page_service,
)
from backend.domains.vault.pages.save_service import (
    SavePageDependencies,
)
from backend.domains.vault.pages.save_service import (
    save_page as save_page_service,
)
from backend.domains.vault.schemas.pages import (
    PageMutationResponse,
    PageCreationStatusResponse,
    PagePatchRequest,
    PageSaveRequest,
)


class UserContext(Protocol):
    user_id: str
    workspace_id: str
    vault_path: Path


class CreateHandler(Protocol):
    """Actual async route signature, including its optional injected context."""

    def __call__(
        self,
        request: PageSaveRequest,
        background_tasks: BackgroundTasks,
        context: UserContext = ...,
        idempotency_key: str | None = ...,
    ) -> Awaitable[dict[str, object]]: ...


class SaveHandler(Protocol):
    """Actual async save handler with its optional injected context."""

    def __call__(
        self,
        page_id: str,
        request: PageSaveRequest,
        background_tasks: BackgroundTasks,
        context: UserContext = ...,
    ) -> Awaitable[dict[str, object]]: ...


class PatchHandler(Protocol):
    """Actual async patch handler with its optional injected context."""

    def __call__(
        self,
        page_id: str,
        request: PagePatchRequest,
        background_tasks: BackgroundTasks,
        context: UserContext = ...,
    ) -> Awaitable[dict[str, object]]: ...


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
        idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    ) -> dict[str, object]:
        """Creates a new page with a UUID ID."""
        if idempotency_key is not None:
            return await create_page_with_receipt(
                request, background_tasks, context.user_id, context.workspace_id,
                context.vault_path, idempotency_key, dependencies,
            )
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

    async def creation_status(
        creation_key: str,
        context: UserContext = Depends(workspace_context_dependency),
    ) -> dict[str, object]:
        return await get_creation_status(context.user_id, context.workspace_id, context.vault_path, creation_key, dependencies)

    router.add_api_route(
        "/pages/creation-requests/{creation_key}", creation_status, methods=["GET"],
        dependencies=[Depends(editor_dependency)], response_model=PageCreationStatusResponse,
    )
    async def resume_creation(
        creation_key: str,
        context: UserContext = Depends(workspace_context_dependency),
    ) -> dict[str, object]:
        return await recover_page_creation(
            context.user_id, context.workspace_id, context.vault_path, creation_key,
            dependencies, guard=recovery_access_guard(context),
        )
    router.add_api_route(
        "/pages/creation-requests/{creation_key}/resume", resume_creation, methods=["POST"],
        dependencies=[Depends(editor_dependency)], response_model=PageMutationResponse,
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
