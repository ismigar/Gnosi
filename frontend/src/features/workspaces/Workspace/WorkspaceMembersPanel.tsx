import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, Trash2, Shield, Loader2 } from 'lucide-react';
import {
    fetchWorkspaceMembers,
    fetchWorkspaceMemberVaults,
    fetchWorkspaceVaults,
    grantWorkspaceMemberVault,
    inviteWorkspaceMember,
    removeWorkspaceMember,
    revokeWorkspaceMemberVault,
    updateWorkspaceMemberRole,
    type WorkspaceMember,
    type WorkspaceMemberVault,
    type WorkspaceMemberVaultAccess,
} from '../../../shared/api/workspace-members';
import { toast } from '../../../shared/notifications/toast';
import ConfirmModal from '../../../shared/ui/dialogs/ConfirmModal';
import { WorkspaceInviteForm } from './WorkspaceInviteForm';
import { WorkspaceVaultAccessPanel } from './WorkspaceVaultAccessPanel';
import {
    isWorkspaceRole,
    type WorkspaceRole,
} from './workspaceMemberModel';

/**
 * Member management panel + vault access for a workspace.
 *
 * Extracted from Dashboard.jsx so it can be embedded in multiple places
 * (Dashboard keeps the version for backward compat; Settings now
 * uses it as the "Workspace" tab).
 *
 * Reuses the existing endpoints:
 *   - GET  /api/workspaces/{id}/members
 *   - POST /api/workspaces/{id}/members  body={email, role}
 *   - PUT  /api/workspaces/{id}/members/{user_id}/role  body={role, permissions}
 *   - DELETE /api/workspaces/{id}/members/{user_id}
 *   - GET  /api/workspaces/{id}/vaults
 *   - GET  /api/workspaces/{id}/members/{user_id}/vaults
 *   - POST /api/workspaces/{id}/members/{user_id}/vaults  body={vault_id, permissions}
 *   - DELETE /api/workspaces/{id}/members/{user_id}/vaults/{vault_id}
 *
 * Props:
 *   - workspaceId (string)  — active workspace
 *   - isAdmin (bool)        — enables add/remove/edit; otherwise, list only
 *   - currentUserId (string?) — protects against deleting yourself
 */
export interface WorkspaceMembersPanelProps {
    readonly currentUserId?: string | null;
    readonly isAdmin?: boolean;
    readonly workspaceId: string;
}


const ROLE_CAPABILITIES: Readonly<Record<WorkspaceRole, readonly string[]>> = {
    viewer: ['read'],
    editor: ['read', 'write'],
    admin: ['read', 'write', 'delete', 'admin', 'analytics', 'tools'],
    owner: ['read', 'write', 'delete', 'admin', 'analytics', 'tools'],
};


export function WorkspaceMembersPanel({
    workspaceId,
    isAdmin = false,
    currentUserId = null,
}: WorkspaceMembersPanelProps) {
    const { t } = useTranslation();
    const [members, setMembers] = useState<WorkspaceMember[]>([]);
    const [loading, setLoading] = useState(false);
    const [vaults, setVaults] = useState<WorkspaceMemberVault[]>([]);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newEmail, setNewEmail] = useState('');
    const [newRole, setNewRole] = useState<WorkspaceRole>('viewer');
    const [selectedMember, setSelectedMember] = useState<WorkspaceMember | null>(null);
    const [vaultAccess, setVaultAccess] = useState<WorkspaceMemberVaultAccess[]>([]);
    const [confirmUserId, setConfirmUserId] = useState<string | null>(null);

    const fetchMembers = useCallback(async (): Promise<void> => {
        if (!workspaceId) return;
        setLoading(true);
        try {
            const data = await fetchWorkspaceMembers(workspaceId);
            setMembers(data);
        } catch (_error) {
            toast.error(t('workspace.members_fetch_failed', { defaultValue: "Error loading members" }));
        } finally {
            setLoading(false);
        }
    }, [workspaceId, t]);

    const fetchVaults = useCallback(async (): Promise<void> => {
        if (!workspaceId) return;
        try {
            const data = await fetchWorkspaceVaults(workspaceId);
            setVaults(data);
        } catch {
            setVaults([]);
        }
    }, [workspaceId]);

    const fetchVaultAccess = useCallback(async (userId: string): Promise<void> => {
        if (!workspaceId || !userId) return;
        try {
            const data = await fetchWorkspaceMemberVaults(workspaceId, userId);
            setVaultAccess(data);
        } catch {
            setVaultAccess([]);
        }
    }, [workspaceId]);

    useEffect(() => {
        let cancelled = false;
        queueMicrotask(() => {
            if (!cancelled) void fetchMembers();
        });
        return () => {
            cancelled = true;
        };
    }, [fetchMembers]);
    useEffect(() => {
        let cancelled = false;
        queueMicrotask(() => {
            if (!cancelled) void fetchVaults();
        });
        return () => {
            cancelled = true;
        };
    }, [fetchVaults]);
    useEffect(() => {
        if (!selectedMember) return undefined;
        let cancelled = false;
        queueMicrotask(() => {
            if (!cancelled) void fetchVaultAccess(selectedMember.user_id);
        });
        return () => {
            cancelled = true;
        };
    }, [selectedMember, fetchVaultAccess]);

    const addMember = async (): Promise<void> => {
        const email = newEmail.trim();
        if (!email) return;
        try {
            await inviteWorkspaceMember(workspaceId, { email, role: newRole });
            toast.success(t('workspace.member_added', { email, newRole, defaultValue: "Invited {{email}} as {{newRole}}" }));
            setNewEmail('');
            setShowAddForm(false);
            void fetchMembers();
        } catch (error) {
            const msg = error instanceof Error ? error.message : undefined;
            toast.error(t('workspace.add_failed', { msg, defaultValue: 'Error: {{msg}}' }));
        }
    };

    const removeMember = (userId: string): void => {
        if (userId === currentUserId) {
            toast.error(t('workspace.cant_remove_self', { defaultValue: "You can't remove yourself" }));
            return;
        }
        setConfirmUserId(userId);
    };

    const doRemove = async (): Promise<void> => {
        const userId = confirmUserId;
        setConfirmUserId(null);
        if (!userId) return;
        try {
            await removeWorkspaceMember(workspaceId, userId);
            void fetchMembers();
        } catch (_error) {
            toast.error(t('workspace.remove_failed', { defaultValue: "Error removing member" }));
        }
    };

    const updateRole = async (
        userId: string,
        newRoleValue: WorkspaceRole,
    ): Promise<void> => {
        try {
            await updateWorkspaceMemberRole(workspaceId, userId, {
                role: newRoleValue,
                permissions: { capabilities: [...ROLE_CAPABILITIES[newRoleValue]] },
            });
            void fetchMembers();
        } catch (_error) {
            toast.error(t('workspace.role_update_failed', { defaultValue: "Error changing role" }));
        }
    };

    const toggleVaultAccess = async (
        userId: string,
        vaultId: string,
    ): Promise<void> => {
        const has = vaultAccess.some((access) => access.vault_id === vaultId);
        try {
            if (has) {
                await revokeWorkspaceMemberVault(workspaceId, userId, vaultId);
            } else {
                await grantWorkspaceMemberVault(workspaceId, userId, {
                    vault_id: vaultId,
                    permissions: { capabilities: ['read'] },
                });
            }
            void fetchVaultAccess(userId);
        } catch (_error) {
            toast.error(t('workspace.vault_access_failed', { defaultValue: "Error changing Vault access" }));
        }
    };

    if (!workspaceId) {
        return (
            <div className="text-sm text-[var(--text-tertiary)] italic px-4 py-6 text-center">
                {t('workspace.no_active', { defaultValue: "No active workspace selected." })}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    {t('workspace.members_title', { defaultValue: "Members" })}
                    <span className="ml-2 text-xs font-normal text-[var(--text-tertiary)]">({members.length})</span>
                </h3>
                {isAdmin && !showAddForm && (
                    <button
                        type="button"
                        onClick={() => {
                            setShowAddForm(true);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-[var(--gnosi-primary)] text-white hover:opacity-90"
                    >
                        <UserPlus size={13} />
                        {t('workspace.invite', { defaultValue: "Invite" })}
                    </button>
                )}
            </div>

            {isAdmin && showAddForm && (
                <WorkspaceInviteForm
                    email={newEmail}
                    onCancel={() => {
                        setShowAddForm(false);
                        setNewEmail('');
                    }}
                    onEmailChange={(email) => {
                        setNewEmail(email);
                    }}
                    onRoleChange={(role) => {
                        setNewRole(role);
                    }}
                    onSubmit={() => {
                        void addMember();
                    }}
                    role={newRole}
                />
            )}

            {loading ? (
                <div className="flex items-center justify-center py-6 text-[var(--text-tertiary)]">
                    <Loader2 size={14} className="animate-spin mr-2" />
                    {t('common.loading', { defaultValue: "Loading..." })}
                </div>
            ) : (
                <div className="rounded-md border border-[var(--border-primary)] overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-[var(--bg-secondary)]/40 text-xs text-[var(--text-secondary)] uppercase">
                            <tr>
                                <th className="px-3 py-2 text-left">{t('workspace.col_email', { defaultValue: 'Email' })}</th>
                                <th className="px-3 py-2 text-left">{t('workspace.col_role', { defaultValue: "Role" })}</th>
                                <th className="px-3 py-2 text-left">{t('workspace.col_joined', { defaultValue: "Since" })}</th>
                                <th className="px-3 py-2 text-right">{t('workspace.col_actions', { defaultValue: '' })}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {members.map((m) => (
                                <tr key={m.user_id} className="border-t border-[var(--border-primary)]/40">
                                    <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{m.email || m.user_id}</td>
                                    <td className="px-3 py-2">
                                        {isAdmin && m.role !== 'owner' ? (
                                            <select
                                                value={m.role}
                                                onChange={(event) => {
                                                    if (isWorkspaceRole(event.target.value)) {
                                                        void updateRole(
                                                            m.user_id,
                                                            event.target.value,
                                                        );
                                                    }
                                                }}
                                                className="px-2 py-1 text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]"
                                            >
                                                <option value="viewer">{t('dashboard.role_viewer', 'Viewer')}</option>
                                                <option value="editor">{t('dashboard.role_editor', 'Editor')}</option>
                                                <option value="admin">{t('dashboard.role_admin', 'Admin')}</option>
                                            </select>
                                        ) : (
                                            <span className="text-xs px-2 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                                                {m.role}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-xs text-[var(--text-tertiary)]">
                                        {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        {isAdmin && (
                                            <div className="flex items-center justify-end gap-1">
                                                <button
                                                    onClick={() => {
                                                        setSelectedMember(m);
                                                    }}
                                                    className="p-1 text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]"
                                                    title={t('workspace.manage_access', { defaultValue: "Manage Vault access" })}
                                                >
                                                    <Shield size={13} />
                                                </button>
                                                {m.role !== 'owner' && m.user_id !== currentUserId && (
                                                    <button
                                                        onClick={() => {
                                                            removeMember(m.user_id);
                                                        }}
                                                        className="p-1 text-[var(--text-tertiary)] hover:text-red-500"
                                                        title={t('workspace.remove', { defaultValue: "Remove" })}
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {members.length === 0 && (
                                <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-[var(--text-tertiary)] italic">
                                    {t('workspace.empty', { defaultValue: "No members yet. Invite someone to get started." })}
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Mini panel for vault access for the selected member */}
            {selectedMember && (
                <WorkspaceVaultAccessPanel
                    access={vaultAccess}
                    member={selectedMember}
                    onClose={() => {
                        setSelectedMember(null);
                    }}
                    onToggleAccess={(userId, vaultId) => {
                        void toggleVaultAccess(userId, vaultId);
                    }}
                    vaults={vaults}
                />
            )}

            <ConfirmModal
                isOpen={confirmUserId != null}
                onClose={() => {
                    setConfirmUserId(null);
                }}
                onConfirm={doRemove}
                title={t('workspace.confirm_remove_title', { defaultValue: "Remove member" })}
                message={t('workspace.confirm_remove', { defaultValue: "Remove this member?" })}
                confirmText={t('common.delete', { defaultValue: "Delete" })}
                cancelText={t('common.cancel', { defaultValue: "Cancel" })}
                isDestructive
            />
        </div>
    );
}

export default WorkspaceMembersPanel;
