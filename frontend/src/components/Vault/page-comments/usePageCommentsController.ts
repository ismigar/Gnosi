import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../../lib/notifyError';
import { toast } from '../../../lib/toast';
import {
    createVaultPageComment,
    deleteVaultPageComment,
    fetchVaultPageComments,
    updateVaultPageComment,
    type VaultPageComment,
} from '../../../shared/api/vault-comments';
import { isCommentMutationForbidden } from './model';
import { currentCommentAuthor } from './storage';
import type { PageCommentsController } from './types';


interface UsePageCommentsControllerOptions {
    readonly open: boolean;
    readonly pageId: string;
}


export function usePageCommentsController({
    open,
    pageId,
}: UsePageCommentsControllerOptions): PageCommentsController {
    const { t } = useTranslation();
    const [comments, setComments] = useState<readonly VaultPageComment[]>([]);
    const [loading, setLoading] = useState(false);
    const [draft, setDraft] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<VaultPageComment | null>(null);

    useEffect(() => {
        if (!open || !pageId) return undefined;
        let cancelled = false;
        void Promise.resolve()
            .then(() => {
                if (cancelled) return undefined;
                setLoading(true);
                return fetchVaultPageComments(pageId);
            })
            .then((thread) => {
                if (!cancelled && thread) setComments(thread.comments);
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                logError('page-comments-load', error);
                toast.error(t('errors.comments_load', {
                    defaultValue: 'Could not load comments',
                }));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, pageId, t]);

    const notifyMutationError = useCallback((
        error: unknown,
        key: string,
        fallback: string,
    ): void => {
        if (isCommentMutationForbidden(error)) {
            toast.error(t('errors.comment_forbidden', {
                defaultValue: 'Your role does not allow modifying comments',
            }));
            return;
        }
        toast.error(t(key, { defaultValue: fallback }));
    }, [t]);

    const submitComment = async (): Promise<void> => {
        const body = draft.trim();
        if (!body || submitting) return;
        setSubmitting(true);
        try {
            const comment = await createVaultPageComment(pageId, {
                author: currentCommentAuthor(),
                body,
            });
            setComments((current) => [...current, comment]);
            setDraft('');
        } catch (error: unknown) {
            logError('page-comments-create', error);
            notifyMutationError(
                error,
                'errors.comment_add',
                'Error afegint el comentari',
            );
        } finally {
            setSubmitting(false);
        }
    };

    const saveEdit = async (commentId: string): Promise<void> => {
        const body = editDraft.trim();
        if (!body) return;
        try {
            const comment = await updateVaultPageComment(pageId, commentId, { body });
            setComments((current) => current.map((item) => (
                item.id === commentId ? comment : item
            )));
            setEditingId(null);
            setEditDraft('');
        } catch (error: unknown) {
            logError('page-comments-edit', error);
            notifyMutationError(
                error,
                'errors.comment_edit',
                'Error editant el comentari',
            );
        }
    };

    const toggleResolved = async (comment: VaultPageComment): Promise<void> => {
        try {
            const updated = await updateVaultPageComment(pageId, comment.id, {
                resolved: !comment.resolved,
            });
            setComments((current) => current.map((item) => (
                item.id === comment.id ? updated : item
            )));
        } catch (error: unknown) {
            logError('page-comments-resolve', error);
            notifyMutationError(
                error,
                'errors.comment_resolve',
                'Error actualitzant el comentari',
            );
        }
    };

    const deleteComment = async (): Promise<void> => {
        const target = deleteTarget;
        if (!target) return;
        try {
            await deleteVaultPageComment(pageId, target.id);
            setComments((current) => current.filter((item) => item.id !== target.id));
        } catch (error: unknown) {
            logError('page-comments-delete', error);
            notifyMutationError(
                error,
                'errors.comment_delete',
                'Error eliminant el comentari',
            );
        } finally {
            setDeleteTarget(null);
        }
    };

    return {
        comments,
        deleteComment,
        deleteTarget,
        draft,
        editDraft,
        editingId,
        loading,
        saveEdit,
        selectDeleteTarget: setDeleteTarget,
        setDraft,
        setEditDraft,
        startEditing: (comment) => {
            setEditingId(comment.id);
            setEditDraft(comment.body);
        },
        stopEditing: () => {
            setEditingId(null);
            setEditDraft('');
        },
        submitComment,
        submitting,
        toggleResolved,
    };
}
