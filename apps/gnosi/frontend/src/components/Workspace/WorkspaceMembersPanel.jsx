import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { UserPlus, Trash2, Shield, X, Loader2, Lock } from 'lucide-react';
import { toast } from '../../lib/toast';

/**
 * Panell de gestió de membres + accés a vaults d'un workspace.
 *
 * Extret de Dashboard.jsx perquè pugui ser embebit a múltiples llocs
 * (Dashboard manté la versió per a backward compat; Settings ara
 * l'utilitza com a pestanya "Workspace").
 *
 * Reutilitza els endpoints existents:
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
 *   - workspaceId (string)  — workspace actiu
 *   - isAdmin (bool)        — habilita add/remove/edit; sinó, només llistar
 *   - currentUserId (string?) — protegeix contra esborrar-se a si mateix
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

    const fetchMembers = useCallback(async () => {
        if (!workspaceId) return;
        setLoading(true);
        try {
            const r = await axios.get(`/api/workspaces/${workspaceId}/members`);
            setMembers(Array.isArray(r.data) ? r.data : []);
        } catch (e) {
            toast.error(t('workspace.members_fetch_failed', { defaultValue: 'Error carregant membres' }));
        } finally {
            setLoading(false);
        }
    }, [workspaceId, t]);

    const fetchVaults = useCallback(async () => {
        if (!workspaceId) return;
        try {
            const r = await axios.get(`/api/workspaces/${workspaceId}/vaults`);
            setVaults(Array.isArray(r.data) ? r.data : []);
        } catch {
            setVaults([]);
        }
    }, [workspaceId]);

    const fetchVaultAccess = useCallback(async (userId) => {
        if (!workspaceId || !userId) return;
        try {
            const r = await axios.get(`/api/workspaces/${workspaceId}/members/${userId}/vaults`);
            setVaultAccess(Array.isArray(r.data) ? r.data : []);
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
            await axios.post(`/api/workspaces/${workspaceId}/members`, { email, role: newRole });
            toast.success(t('workspace.member_added', { defaultValue: `Convidat ${email} com a ${newRole}` }));
            setNewEmail('');
            setShowAddForm(false);
            fetchMembers();
        } catch (e) {
            const msg = e?.response?.data?.detail || e?.message;
            toast.error(t('workspace.add_failed', { defaultValue: `Error: ${msg}` }));
        }
    };

    const removeMember = async (userId) => {
        if (userId === currentUserId) {
            toast.error(t('workspace.cant_remove_self', { defaultValue: 'No pots eliminar-te a tu mateix' }));
            return;
        }
        if (!window.confirm(t('workspace.confirm_remove', { defaultValue: 'Eliminar aquest membre?' }))) return;
        try {
            await axios.delete(`/api/workspaces/${workspaceId}/members/${userId}`);
            fetchMembers();
        } catch (e) {
            toast.error(t('workspace.remove_failed', { defaultValue: 'Error eliminant membre' }));
        }
    };

    const updateRole = async (userId, newRoleValue) => {
        try {
            await axios.put(`/api/workspaces/${workspaceId}/members/${userId}/role`, {
                role: newRoleValue,
                permissions: { capabilities: ROLE_CAPABILITIES[newRoleValue] || ['read'] },
            });
            fetchMembers();
        } catch (e) {
            toast.error(t('workspace.role_update_failed', { defaultValue: 'Error canviant rol' }));
        }
    };

    const toggleVaultAccess = async (userId, vaultId) => {
        const has = vaultAccess.some(a => a.vault_id === vaultId);
        try {
            if (has) {
                await axios.delete(`/api/workspaces/${workspaceId}/members/${userId}/vaults/${vaultId}`);
            } else {
                await axios.post(`/api/workspaces/${workspaceId}/members/${userId}/vaults`, {
                    vault_id: vaultId,
                    permissions: { capabilities: ['read'] },
                });
            }
            fetchVaultAccess(userId);
        } catch (e) {
            toast.error(t('workspace.vault_access_failed', { defaultValue: 'Error canviant accés a vault' }));
        }
    };

    if (!workspaceId) {
        return (
            <div className="text-sm text-[var(--text-tertiary)] italic px-4 py-6 text-center">
                {t('workspace.no_active', { defaultValue: 'Cap workspace actiu seleccionat.' })}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    {t('workspace.members_title', { defaultValue: 'Membres' })}
                    <span className="ml-2 text-xs font-normal text-[var(--text-tertiary)]">({members.length})</span>
                </h3>
                {isAdmin && !showAddForm && (
                    <button
                        type="button"
                        onClick={() => setShowAddForm(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-[var(--gnosi-primary)] text-white hover:opacity-90"
                    >
                        <UserPlus size={13} />
                        {t('workspace.invite', { defaultValue: 'Convida' })}
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
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                        <option value="admin">Admin</option>
                    </select>
                    <button onClick={addMember} className="px-3 py-1 text-xs rounded-md bg-[var(--gnosi-primary)] text-white">OK</button>
                    <button onClick={() => { setShowAddForm(false); setNewEmail(''); }} className="text-[var(--text-tertiary)] p-1"><X size={14} /></button>
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-6 text-[var(--text-tertiary)]">
                    <Loader2 size={14} className="animate-spin mr-2" />
                    {t('common.loading', { defaultValue: 'Carregant…' })}
                </div>
            ) : (
                <div className="rounded-md border border-[var(--border-primary)] overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-[var(--bg-secondary)]/40 text-xs text-[var(--text-secondary)] uppercase">
                            <tr>
                                <th className="px-3 py-2 text-left">{t('workspace.col_email', { defaultValue: 'Email' })}</th>
                                <th className="px-3 py-2 text-left">{t('workspace.col_role', { defaultValue: 'Rol' })}</th>
                                <th className="px-3 py-2 text-left">{t('workspace.col_joined', { defaultValue: 'Des de' })}</th>
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
                                                <option value="viewer">Viewer</option>
                                                <option value="editor">Editor</option>
                                                <option value="admin">Admin</option>
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
                                                    title={t('workspace.manage_access', { defaultValue: 'Gestiona accés a vaults' })}
                                                >
                                                    <Shield size={13} />
                                                </button>
                                                {m.role !== 'owner' && m.user_id !== currentUserId && (
                                                    <button
                                                        onClick={() => removeMember(m.user_id)}
                                                        className="p-1 text-[var(--text-tertiary)] hover:text-red-500"
                                                        title={t('workspace.remove', { defaultValue: 'Elimina' })}
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
                                    {t('workspace.empty', { defaultValue: 'Cap membre encara. Convida algú per començar.' })}
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Mini-panel d'accés a vaults per membre seleccionat */}
            {selectedMember && (
                <div className="mt-3 p-4 rounded-md border border-[var(--gnosi-primary)]/30 bg-[var(--gnosi-primary)]/5">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <Lock size={14} className="text-[var(--gnosi-primary)]" />
                            {t('workspace.vault_access_for', {
                                defaultValue: `Accés a vaults — ${selectedMember.email || selectedMember.user_id}`,
                            })}
                        </div>
                        <button onClick={() => setSelectedMember(null)} className="text-[var(--text-tertiary)] p-1"><X size={14} /></button>
                    </div>
                    {vaults.length === 0 ? (
                        <p className="text-xs text-[var(--text-tertiary)] italic">
                            {t('workspace.no_vaults', { defaultValue: 'No hi ha vaults a aquest workspace.' })}
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
                                                ? t('workspace.has_access', { defaultValue: 'Té accés' })
                                                : t('workspace.grant_access', { defaultValue: 'Concedeix' })}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

export default WorkspaceMembersPanel;
