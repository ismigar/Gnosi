import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type WorkspaceMember = components['schemas']['MemberResponse'];
export type WorkspaceMemberVault =
  components['schemas']['WorkspaceMemberVaultResponse'];
export type WorkspaceMemberVaultAccess =
  components['schemas']['VaultAccessResponse'];
export type WorkspaceMemberOperation =
  components['schemas']['WorkspaceMemberOperationResponse'];
export type WorkspaceMemberInviteInput =
  components['schemas']['AddMemberRequest'];
export type WorkspaceMemberRoleInput =
  components['schemas']['RoleUpdateRequest'];
export type WorkspaceMemberVaultGrantInput = Omit<
  components['schemas']['VaultAccessRequest'],
  'user_id'
>;


export async function fetchWorkspaceMembers(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<WorkspaceMember[]> {
  return unwrapApiResult<WorkspaceMember[], unknown>(
    await apiClient.GET('/api/workspaces/{workspace_id}/members', {
      params: { path: { workspace_id: workspaceId } },
      signal,
    }),
  );
}


export async function fetchWorkspaceVaults(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<WorkspaceMemberVault[]> {
  return unwrapApiResult<WorkspaceMemberVault[], unknown>(
    await apiClient.GET('/api/workspaces/{workspace_id}/vaults', {
      params: { path: { workspace_id: workspaceId } },
      signal,
    }),
  );
}


export async function fetchWorkspaceMemberVaults(
  workspaceId: string,
  userId: string,
  signal?: AbortSignal,
): Promise<WorkspaceMemberVaultAccess[]> {
  return unwrapApiResult<WorkspaceMemberVaultAccess[], unknown>(
    await apiClient.GET(
      '/api/workspaces/{workspace_id}/members/{user_id}/vaults',
      {
        params: {
          path: { workspace_id: workspaceId, user_id: userId },
        },
        signal,
      },
    ),
  );
}


export async function inviteWorkspaceMember(
  workspaceId: string,
  input: WorkspaceMemberInviteInput,
): Promise<WorkspaceMemberOperation> {
  return unwrapApiResult<WorkspaceMemberOperation, unknown>(
    await apiClient.POST('/api/workspaces/{workspace_id}/members', {
      params: { path: { workspace_id: workspaceId } },
      body: input,
    }),
  );
}


export async function removeWorkspaceMember(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMemberOperation> {
  return unwrapApiResult<WorkspaceMemberOperation, unknown>(
    await apiClient.DELETE(
      '/api/workspaces/{workspace_id}/members/{target_user_id}',
      {
        params: {
          path: {
            workspace_id: workspaceId,
            target_user_id: userId,
          },
        },
      },
    ),
  );
}


export async function updateWorkspaceMemberRole(
  workspaceId: string,
  userId: string,
  input: WorkspaceMemberRoleInput,
): Promise<WorkspaceMemberOperation> {
  return unwrapApiResult<WorkspaceMemberOperation, unknown>(
    await apiClient.PUT(
      '/api/workspaces/{workspace_id}/members/{target_user_id}/role',
      {
        params: {
          path: {
            workspace_id: workspaceId,
            target_user_id: userId,
          },
        },
        body: input,
      },
    ),
  );
}


export async function grantWorkspaceMemberVault(
  workspaceId: string,
  userId: string,
  input: WorkspaceMemberVaultGrantInput,
): Promise<WorkspaceMemberOperation> {
  return unwrapApiResult<WorkspaceMemberOperation, unknown>(
    await apiClient.POST(
      '/api/workspaces/{workspace_id}/members/{user_id}/vaults',
      {
        params: {
          path: { workspace_id: workspaceId, user_id: userId },
        },
        body: input as components['schemas']['VaultAccessRequest'],
      },
    ),
  );
}


export async function revokeWorkspaceMemberVault(
  workspaceId: string,
  userId: string,
  vaultId: string,
): Promise<WorkspaceMemberOperation> {
  return unwrapApiResult<WorkspaceMemberOperation, unknown>(
    await apiClient.DELETE(
      '/api/workspaces/{workspace_id}/members/{user_id}/vaults/{vault_id}',
      {
        params: {
          path: {
            workspace_id: workspaceId,
            user_id: userId,
            vault_id: vaultId,
          },
        },
      },
    ),
  );
}
