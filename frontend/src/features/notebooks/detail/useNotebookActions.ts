import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { cancelNotebookRefresh, deleteNotebook as deleteNotebookRequest, refreshNotebook as requestNotebookRefresh, refreshNotebookSource, removeNotebookSource, updateNotebook, type NotebookUpdateInput } from '../../../shared/api/notebooks';
import { transportFetch } from '../../../shared/api/transports';
import { toast } from '../../../shared/notifications/toast';
import { vaultPath } from '../../../shared/routing/vaultRouting';
import { moveResource } from './notebookModel';
import type { NotebookGroup } from './notebookTypes';
import type { useNotebookDetailData } from './useNotebookDetailData';

export function useNotebookActions(notebookId: string, { notebook, setNotebook, load }: ReturnType<typeof useNotebookDetailData>) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [showAdd, setShowAdd] = useState(false);
    const [showDelete, setShowDelete] = useState(false);
    const [showClear, setShowClear] = useState(false);
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [editingGroup, setEditingGroup] = useState<NotebookGroup | null>(null);
    const [chatEpoch, setChatEpoch] = useState(0);
    const [removingId, setRemovingId] = useState('');
    const [retryingId, setRetryingId] = useState('');
    const [cancelling, setCancelling] = useState(false);
    const patchNotebook = async (patch: NotebookUpdateInput) => {
        try {
            setNotebook(await updateNotebook(notebookId, patch));
        } catch {
            toast.error(t('notebooks.settings_error', 'Notebook settings could not be saved.'));
        }
    };

    const handleSaveGroup = async (name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const currentGroups = notebook?.groups || [];
        let nextGroups;
        if (editingGroup) {
            nextGroups = currentGroups.map((g) => (g.id === editingGroup.id ? { ...g, name: trimmed } : g));
        } else {
            const newGroup = {
                id: `grp_${String(Date.now())}_${Math.random().toString(36).slice(2, 7)}`,
                name: trimmed,
                resource_ids: [],
            };
            nextGroups = [...currentGroups, newGroup];
        }
        await patchNotebook({ groups: nextGroups });
        setEditingGroup(null);
    };

    const handleDeleteGroup = async (groupId: string) => {
        const currentGroups = notebook?.groups || [];
        const nextGroups = currentGroups.filter((g) => g.id !== groupId);
        await patchNotebook({ groups: nextGroups });
    };

    const handleMoveResource = async (resourceId: string, targetGroupId: string) => {
        const nextGroups = moveResource(notebook?.groups || [], resourceId, targetGroupId);
        await patchNotebook({ groups: nextGroups });
    };

    const refresh = async () => {
        try {
            await requestNotebookRefresh(notebookId);
            toast.success(t('notebooks.refresh_started', 'Refresh started.'));
            void load({ refresh: false });
        } catch {
            toast.error(t('notebooks.refresh_error', 'The notebook refresh could not be started.'));
        }
    };
    const retryResource = async (resourceId: string) => {
        setRetryingId(resourceId);
        try {
            await refreshNotebookSource(notebookId, resourceId);
            toast.success(t('notebooks.resource_retry_started', 'Resource retry started.'));
            await load({ refresh: false });
        } catch {
            toast.error(t('notebooks.resource_retry_error', 'The Resource retry could not be started.'));
        } finally {
            setRetryingId('');
        }
    };
    const cancelRefresh = async () => {
        setCancelling(true);
        try {
            setNotebook(await cancelNotebookRefresh(notebookId));
            toast.success(t('notebooks.index_cancelled', 'Indexing cancelled.'));
            await load({ refresh: false });
        } catch {
            toast.error(t('notebooks.index_cancel_error', 'Indexing could not be cancelled.'));
        } finally {
            setCancelling(false);
        }
    };
    const remove = async (resourceId: string) => {
        setRemovingId(resourceId);
        try {
            await removeNotebookSource(notebookId, resourceId);
            toast.success(t('notebooks.resource_removed', 'Resource removed from the notebook.'));
            await load({ refresh: false });
        } catch {
            toast.error(t('notebooks.resource_remove_error', 'The Resource could not be removed.'));
        } finally { setRemovingId(''); }
    };
    const deleteNotebook = async () => {
        try {
            await deleteNotebookRequest(notebookId);
            toast.success(t('notebooks.deleted', 'Notebook deleted.'));
            void navigate(vaultPath('notebooks'));
        } catch {
            toast.error(t('notebooks.delete_error', 'The notebook could not be deleted.'));
        }
    };
    const clearConversation = async () => {
        if (!notebook) return;
        const response = await transportFetch(
            `/api/chat/sessions/gnosy/${encodeURIComponent(notebook.conversation_session_id)}?notebook_id=${encodeURIComponent(notebook.id)}`,
            { method: 'DELETE' },
        );
        if (response.ok) {
            setShowClear(false);
            setChatEpoch((value) => value + 1);
            toast.success(t('notebooks.conversation_cleared', 'Conversation cleared.'));
            return;
        }
        toast.error(t('notebooks.conversation_clear_error', 'The conversation could not be cleared.'));
    };

    return { showAdd, setShowAdd, showDelete, setShowDelete, showClear, setShowClear,
        showGroupModal, setShowGroupModal, editingGroup, setEditingGroup, chatEpoch,
        removingId, retryingId, cancelling, patchNotebook, handleSaveGroup,
        handleDeleteGroup, handleMoveResource, refresh, retryResource,
        cancelRefresh, remove, deleteNotebook, clearConversation };
}
