"""Compatibility facade for the workspace domain router.

Remove this historical import path in Gnosi PR6 after application composition
and downstream imports use the domain package directly.
"""

from typing import Any

from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict

from backend.domains.workspace.api.routes import (
    add_workspace_member,
    create_workspace,
    get_workspace,
    grant_vault_access,
    list_member_vault_access,
    list_workspace_members,
    list_workspace_vaults,
    list_workspaces,
    remove_workspace_member,
    revoke_vault_access,
    router,
    update_member_role,
)
from backend.models.management import MemberResponse, VaultAccessResponse


class WorkspaceMemberOperationResponse(BaseModel):
    """Stable JSON envelope returned by workspace member mutations."""

    status: str
    message: str

    model_config = ConfigDict(extra="allow")


class WorkspaceMemberVaultResponse(BaseModel):
    """Vault summary exposed by the workspace member-access panel."""

    id: str
    name: str

    model_config = ConfigDict(extra="allow")


_MEMBER_RESPONSE_MODELS: dict[str, Any] = {
    "list_workspace_members": list[MemberResponse],
    "list_workspace_vaults": list[WorkspaceMemberVaultResponse],
    "list_member_vault_access": list[VaultAccessResponse],
    "add_workspace_member": WorkspaceMemberOperationResponse,
    "remove_workspace_member": WorkspaceMemberOperationResponse,
    "update_member_role": WorkspaceMemberOperationResponse,
    "grant_vault_access": WorkspaceMemberOperationResponse,
    "revoke_vault_access": WorkspaceMemberOperationResponse,
}


def _route_with_response_model(route: APIRoute, response_model: Any) -> APIRoute:
    """Rebuild one extracted route while preserving its observable contract."""

    return APIRoute(
        path=route.path,
        endpoint=route.endpoint,
        response_model=response_model,
        status_code=route.status_code,
        tags=route.tags,
        dependencies=route.dependencies,
        summary=route.summary,
        description=route.description,
        response_description=route.response_description,
        responses=route.responses,
        deprecated=route.deprecated,
        name=route.name,
        methods=route.methods,
        operation_id=route.operation_id,
        response_model_include=route.response_model_include,
        response_model_exclude=route.response_model_exclude,
        response_model_by_alias=route.response_model_by_alias,
        response_model_exclude_unset=route.response_model_exclude_unset,
        response_model_exclude_defaults=route.response_model_exclude_defaults,
        response_model_exclude_none=route.response_model_exclude_none,
        include_in_schema=route.include_in_schema,
        response_class=route.response_class,
        dependency_overrides_provider=route.dependency_overrides_provider,
        callbacks=route.callbacks,
        openapi_extra=route.openapi_extra,
        generate_unique_id_function=route.generate_unique_id_function,
        strict_content_type=route.strict_content_type,
    )


def _publish_member_response_models() -> None:
    for index, route in enumerate(router.routes):
        if not isinstance(route, APIRoute):
            continue
        response_model = _MEMBER_RESPONSE_MODELS.get(route.endpoint.__name__)
        if response_model is None:
            continue
        router.routes[index] = _route_with_response_model(route, response_model)


_publish_member_response_models()

__all__ = [
    "WorkspaceMemberOperationResponse",
    "WorkspaceMemberVaultResponse",
    "add_workspace_member",
    "create_workspace",
    "get_workspace",
    "grant_vault_access",
    "list_member_vault_access",
    "list_workspace_members",
    "list_workspace_vaults",
    "list_workspaces",
    "remove_workspace_member",
    "revoke_vault_access",
    "router",
    "update_member_role",
]
