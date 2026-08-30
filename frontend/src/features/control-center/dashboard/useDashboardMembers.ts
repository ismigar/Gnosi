import {useCallback, useEffect, useState} from 'react';
import {useApi} from '../../../hooks/use-api';
import type {WorkspaceMember, WorkspaceMemberVault, WorkspaceMemberVaultAccess} from '../../../shared/api/workspace-members';
import {normalizeMember, type DashboardMember} from './model';
export function useDashboardMembers(activeWorkspaceId: string, selectedControlTab: string, isAdmin: boolean) {
const {apiFetch} = useApi();
    const [members, setMembers] = useState<DashboardMember[]>([]);
    const [membersLoading, setMembersLoading] = useState(false);
    const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
    const [isPermissionsModalOpen, setIsPermissionsModalOpen] = useState(false);

    const [selectedMember, setSelectedMember] = useState<DashboardMember | null>(null);
    const [newMemberEmail, setNewMemberEmail] = useState('');
    const [newMemberRole, setNewMemberRole] = useState('viewer');
    const [allVaults, setAllVaults] = useState<WorkspaceMemberVault[]>([]);
    const [memberVaultAccess, setMemberVaultAccess] = useState<WorkspaceMemberVaultAccess[]>([]);
    const [vaultAccessLoading, setVaultAccessLoading] = useState(false);
    const fetchMembers = useCallback(async () => {
        await Promise.resolve();
        setMembersLoading(true);
        try {
            const res = await apiFetch<WorkspaceMember[]>(`/api/workspaces/${activeWorkspaceId}/members`);
            setMembers(res.map(normalizeMember));
        } catch { /* Retain the current view when a background request fails. */ } finally {
            setMembersLoading(false);
        }
    }, [activeWorkspaceId, apiFetch]);

    const handleAddMember = useCallback(async () => {
        if (!newMemberEmail) return;
        try {
            await apiFetch(`/api/workspaces/${activeWorkspaceId}/members`, {
                method: 'POST',
                body: JSON.stringify({ email: newMemberEmail, role: newMemberRole })
            });
            setIsAddMemberModalOpen(false);
            setNewMemberEmail('');
            void fetchMembers();
        } catch { /* Retain the current view when a background request fails. */ }
    }, [newMemberEmail, activeWorkspaceId, newMemberRole, fetchMembers, apiFetch]);

    const [confirmDeleteMember, setConfirmDeleteMember] = useState<string | null>(null);
    const handleDeleteMember = (userId: string) => { setConfirmDeleteMember(userId); };
    const doDeleteMember = async () => {
        const userId = confirmDeleteMember;
        setConfirmDeleteMember(null);
        if (userId === null) return;
        try {
            await apiFetch(`/api/workspaces/${activeWorkspaceId}/members/${userId}`, {
                method: 'DELETE'
            });
            void fetchMembers();
        } catch { /* Retain the current view when a background request fails. */ }
    };

    const handleUpdatePermissions = useCallback(async (userId: string, permissions: DashboardMember["permissions"], role: string) => {
        try {
            await apiFetch(`/api/workspaces/${activeWorkspaceId}/members/${userId}/role`, {
                method: 'PUT',
                body: JSON.stringify({ permissions, role })
            });
            void fetchMembers();
            setIsPermissionsModalOpen(false);
        } catch { /* Retain the current view when a background request fails. */ }
    }, [activeWorkspaceId, fetchMembers, apiFetch]);

    const fetchVaults = useCallback(async () => {
        try {
            const res = await apiFetch<WorkspaceMemberVault[]>(`/api/workspaces/${activeWorkspaceId}/vaults`);
            setAllVaults(res);
        } catch { /* Retain the current view when a background request fails. */ }
    }, [activeWorkspaceId, apiFetch]);

    const fetchMemberVaultAccess = useCallback(async (userId: string) => {
        await Promise.resolve();
        setVaultAccessLoading(true);
        try {
            const res = await apiFetch<WorkspaceMemberVaultAccess[]>(`/api/workspaces/${activeWorkspaceId}/members/${userId}/vaults`);
            setMemberVaultAccess(res);
        } catch { /* Retain the current view when a background request fails. */ } finally {
            setVaultAccessLoading(false);
        }
    }, [activeWorkspaceId, apiFetch]);

    const toggleVaultAccess = async (userId: string, vaultId: string) => {
        const hasAccess = memberVaultAccess.some(a => a.vault_id === vaultId);
        try {
            if (hasAccess) {
                await apiFetch(`/api/workspaces/${activeWorkspaceId}/members/${userId}/vaults/${vaultId}`, {
                    method: 'DELETE'
                });
            } else {
                await apiFetch(`/api/workspaces/${activeWorkspaceId}/members/${userId}/vaults`, {
                    method: 'POST',
                    body: JSON.stringify({ vault_id: vaultId, permissions: { capabilities: ["read"] } })
                });
            }
            void fetchMemberVaultAccess(userId);
        } catch { /* Retain the current view when a background request fails. */ }
    };

    useEffect(() => {
        if (selectedControlTab === 'admin' && isAdmin) {
            void Promise.resolve().then(() => { void fetchMembers(); void fetchVaults(); });
        }
    }, [selectedControlTab, isAdmin, fetchMembers, fetchVaults]);

    useEffect(() => {
        if (isPermissionsModalOpen && selectedMember) {
            void Promise.resolve().then(() => { void fetchMemberVaultAccess(selectedMember.user_id); });
        }
    }, [isPermissionsModalOpen, selectedMember, fetchMemberVaultAccess]);


return {members, membersLoading, isAddMemberModalOpen, setIsAddMemberModalOpen, isPermissionsModalOpen, setIsPermissionsModalOpen, selectedMember, setSelectedMember, newMemberEmail, setNewMemberEmail, newMemberRole, setNewMemberRole, allVaults, memberVaultAccess, vaultAccessLoading, confirmDeleteMember, setConfirmDeleteMember, handleAddMember, handleDeleteMember, doDeleteMember, handleUpdatePermissions, toggleVaultAccess};
}
