"""Compatibility facade for the workspace domain router.

Remove this historical import path in Gnosi PR6 after application composition
and downstream imports use the domain package directly.
"""

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
from backend.domains.workspace.api.schemas import (
    WorkspaceMemberOperationResponse,
    WorkspaceMemberVaultResponse,
)

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
