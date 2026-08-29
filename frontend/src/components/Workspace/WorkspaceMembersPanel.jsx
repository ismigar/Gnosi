import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, Trash2, Shield, X, Loader2, Lock } from 'lucide-react';
import {
    fetchWorkspaceMembers,
    fetchWorkspaceMemberVaults,
    fetchWorkspaceVaults,
    grantWorkspaceMemberVault,
    inviteWorkspaceMember,
    removeWorkspaceMember,
    revokeWorkspaceMemberVault,
    updateWorkspaceMemberRole,
} from '../../shared/api/workspace-members';
import { toast } from '../../lib/toast';
import ConfirmModal from '../ConfirmModal';

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
const ROLE_CAPABILITIES = {
    viewer: ['read'],
    editor: ['read', 'write'],
    admin: ['read', 'write', 'delete', 'admin', 'analytics', 'tools'],
    owner: ['read', 'write', 'delete', 'admin', 'analytics', 'tools'],
};

export function WorkspaceMembersPanel({ workspaceId, isAdmin = false, currentUserId = null }) {
    const { t } = useTranslation();
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [vaults, setVaults] = useState([]);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newEmail, setNewEmail] = useState('');
    const [newRole, setNewRole] = useState('viewer');
    const [selectedMember, setSelectedMember] = useState(null);
    const [vaultAccess, setVaultAccess] = useState([]);
    const [confirmUserId, setConfirmUserId] = useState(null);

    const fetchMembers = useCallback(async () => {
        if (!workspaceId) return;
        setLoading(true);
        try {
            const data = await fetchWorkspaceMembers(workspaceId);
            setMembers(Array.isArray(data) ? data : []);
        } catch (_error) {
            toast.error(t('workspace.members_fetch_failed', { defaultValue: "Error loading members" }));
        } finally {
            setLoading(false);
        }
    }, [workspaceId, t]);

    const fetchVaults = useCallback(async () => {
        if (!workspaceId) return;
        try {
            const data = await fetchWorkspaceVaults(workspaceId);
            setVaults(Array.isArray(data) ? data : []);
        } catch {
            setVaults([]);
        }
    }, [workspaceId]);

    const fetchVaultAccess = useCallback(async (userId) => {
        if (!workspaceId || !userId) return;
        try {
            const data = await fetchWorkspaceMemberVaults(workspaceId, userId);
            setVaultAccess(Array.isArray(data) ? data : []);
        } catch {
            setVaultAccess([]);
        }
    }, [workspaceId]);

    useEffect(() => { fetchMembers(); }, [fetchMembers]);
    useEffect(() => { fetchVaults(); }, [fetchVaults]);
    useEffect(() => {
        if (selectedMember) fetchVaultAccess(selectedMember.user_id);
    }, [selectedMember, fetchVaultAccess]);

    const addMember = async () => {
        const email = newEmail.trim();
        if (!email) return;
        try {
            await inviteWorkspaceMember(workspaceId, { email, role: newRole });
            toast.success(t('workspace.member_added', { email, newRole, defaultValue: "Invited {{email}} as {{newRole}}" }));
            setNewEmail('');
            setShowAddForm(false);
            fetchMembers();
        } catch (error) {
            const msg = error instanceof Error ? error.message : undefined;
            toast.error(t('workspace.add_failed', { msg, defaultValue: 'Error: {{msg}}' }));
        }
    };

    const removeMember = (userId) => {
        if (userId === currentUserId) {
            toast.error(t('workspace.cant_remove_self', { defaultValue: "You can't remove yourself" }));
            return;
        }
        setConfirmUserId(userId);
    };

    const doRemove = async () => {
        const userId = confirmUserId;
        setConfirmUserId(null);
        try {
            await removeWorkspaceMember(workspaceId, userId);
            fetchMembers();
        } catch (_error) {
            toast.error(t('workspace.remove_failed', { defaultValue: "Error removing member" }));
        }
    };

    const updateRole = async (userId, newRoleValue) => {
        try {
            await updateWorkspaceMemberRole(workspaceId, userId, {
                role: newRoleValue,
                permissions: { capabilities: ROLE_CAPABILITIES[newRoleValue] || ['read'] },
            });
            fetchMembers();
        } catch (_error) {
            toast.error(t('workspace.role_update_failed', { defaultValue: "Error changing role" }));
        }
    };

    const toggleVaultAccess = async (userId, vaultId) => {
        const has = vaultAccess.some(a => a.vault_id === vaultId);
        try {
            if (has) {
                await revokeWorkspaceMemberVault(workspaceId, userId, vaultId);
            } else {
                await grantWorkspaceMemberVault(workspaceId, userId, {
                    vault_id: vaultId,
                    permissions: { capabilities: ['read'] },
                });
            }
            fetchVaultAccess(userId);
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
                        onClick={() => setShowAddForm(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-[var(--gnosi-primary)] text-white hover:opacity-90"
                    >
                        <UserPlus size={13} />
                        {t('workspace.invite', { defaultValue: "Invite" })}
                    </button>
                )}
            </div>

            {isAdmin && showAddForm && (
                <div className="flex items-center gap-2 p-3 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)]/30">
                    <input
                        autoFocus
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') addMember(); if (e.key === 'Escape') setShowAddForm(false); }}
                        placeholder={t('workspace.email_placeholder', { defaultValue: 'email@cooperativa.coop' })}
                        className="flex-1 px-2 py-1 text-sm rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                    />
                    <select
                        value={newRole}
                        onChange={(e) => setNewRole(e.target.value)}
                        className="px-2 py-1 text-sm rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)]"
                    >
                        <option value="viewer">{t('dashboard.role_viewer', 'Viewer')}</option>
                        <option value="editor">{t('dashboard.role_editor', 'Editor')}</option>
                        <option value="admin">{t('dashboard.role_admin', 'Admin')}</option>
                    </select>
                    <button onClick={addMember} className="px-3 py-1 text-xs rounded-md bg-[var(--gnosi-primary)] text-white">{t('workspace.ok', 'OK')}</button>
                    <button onClick={() => { setShowAddForm(false); setNewEmail(''); }} className="text-[var(--text-tertiary)] p-1"><X size={14} /></button>
                </div>
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
                                                onChange={(e) => updateRole(m.user_id, e.target.value)}
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
                                                    onClick={() => setSelectedMember(m)}
                                                    className="p-1 text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]"
                                                    title={t('workspace.manage_access', { defaultValue: "Manage Vault access" })}
                                                >
                                                    <Shield size={13} />
                                                </button>
                                                {m.role !== 'owner' && m.user_id !== currentUserId && (
                                                    <button
                                                        onClick={() => removeMember(m.user_id)}
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
                <div className="mt-3 p-4 rounded-md border border-[var(--gnosi-primary)]/30 bg-[var(--gnosi-primary)]/5">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <Lock size={14} className="text-[var(--gnosi-primary)]" />
                            {t('workspace.vault_access_for', {
                                email: selectedMember.email || selectedMember.user_id,
                                defaultValue: "Vault access — {{email}}",
                            })}
                        </div>
                        <button onClick={() => setSelectedMember(null)} className="text-[var(--text-tertiary)] p-1"><X size={14} /></button>
                    </div>
                    {vaults.length === 0 ? (
                        <p className="text-xs text-[var(--text-tertiary)] italic">
                            {t('workspace.no_vaults', { defaultValue: "There are no Vaults in this workspace." })}
                        </p>
                    ) : (
                        <ul className="space-y-1.5">
                            {vaults.map(v => {
                                const has = vaultAccess.some(a => a.vault_id === v.id);
                                return (
                                    <li key={v.id} className="flex items-center justify-between text-xs">
                                        <span>{v.name || v.id}</span>
                                        <button
                                            onClick={() => toggleVaultAccess(selectedMember.user_id, v.id)}
                                            className={`px-2 py-0.5 rounded ${
                                                has ? 'bg-[var(--gnosi-primary)] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                                            }`}
                                        >
                                            {has
                                                ? t('workspace.has_access', { defaultValue: "Has access" })
                                                : t('workspace.grant_access', { defaultValue: "Grant" })}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}

            <ConfirmModal
                isOpen={confirmUserId != null}
                onClose={() => setConfirmUserId(null)}
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
