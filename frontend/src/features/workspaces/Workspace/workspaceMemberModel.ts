import type { WorkspaceMemberInviteInput } from '../../../shared/api/workspace-members';


export type WorkspaceRole = WorkspaceMemberInviteInput['role'];


export function isWorkspaceRole(value: string): value is WorkspaceRole {
    return value === 'viewer'
        || value === 'editor'
        || value === 'admin'
        || value === 'owner';
}
