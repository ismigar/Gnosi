import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { MessageSquare, X, Send, Trash2, Check, RotateCcw, Loader2, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../lib/toast';
import { useApi } from '../../hooks/use-api';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { ConfirmModal } from '../ConfirmModal';
import i18n from '../../i18n';

function fmtWhen(iso) {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString(i18n.language, {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return iso;
    }
}

function currentAuthor() {
    try {
        const email = localStorage.getItem('gnosi_user_email') || '';
        if (email) return email.split('@')[0];
    } catch { /* noop */ }
    return 'Anònim';
}

/**
 * Sliding comments panel for a page (Notion style). Flat thread with
 * add / edit / resolve / delete. Persisted to `.gnosi/page_comments.json`.
 * Viewers only read: the backend returns 403 on mutations (PR #742)
 * and the composer and write actions are hidden from them here.
 */
export function PageComments({ pageId, pageTitle, open, onClose }) {
    const { t } = useTranslation();
    const { role } = useApi();
    const canComment = role !== 'viewer';
    const panelRef = useRef(null);
    const [comments, setComments] = useState([]);
    const [loading, setLoading] = useState(false);
    const [draft, setDraft] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editDraft, setEditDraft] = useState('');
    const [deleteTarget, setDeleteTarget] = useState(null);

    const fetchComments = useCallback(async () => {
        if (!pageId) return;
        setLoading(true);
        try {
            const res = await axios.get(`/api/vault/pages/${pageId}/comments`);
            setComments(res.data?.comments || []);
        } catch (err) {
            console.error('Error loading comments:', err);
            toast.error(t('errors.comments_load', { defaultValue: "Could not load comments" }));
        } finally {
            setLoading(false);
        }
    }, [pageId, t]);

    useEffect(() => {
        if (open && pageId) fetchComments();
    }, [open, pageId, fetchComments]);

    // 403 (viewer role, PR #742) → permissions message; otherwise → generic key.
    const notifyMutationError = useCallback((err, key, fallback) => {
        if (err?.response?.status === 403) {
            toast.error(t('errors.comment_forbidden', { defaultValue: "Your role does not allow modifying comments" }));
        } else {
            toast.error(t(key, { defaultValue: fallback }));
        }
    }, [t]);

    useModalKeyboard({
        isOpen: open,
        onClose,
        containerRef: panelRef,
        trapFocus: true,
        closeOnEscape: !deleteTarget,
    });

    const submitComment = async () => {
        const body = draft.trim();
        if (!body || submitting) return;
        setSubmitting(true);
        try {
            const res = await axios.post(`/api/vault/pages/${pageId}/comments`, {
                body,
                author: currentAuthor(),
            });
            setComments(prev => [...prev, res.data]);
            setDraft('');
        } catch (err) {
            console.error('Error adding comment:', err);
            notifyMutationError(err, 'errors.comment_add', 'Error afegint el comentari');
        } finally {
            setSubmitting(false);
        }
    };

    const saveEdit = async (commentId) => {
        const body = editDraft.trim();
        if (!body) return;
        try {
            const res = await axios.patch(`/api/vault/pages/${pageId}/comments/${commentId}`, { body });
            setComments(prev => prev.map(c => (c.id === commentId ? res.data : c)));
            setEditingId(null);
            setEditDraft('');
        } catch (err) {
            console.error('Error editing comment:', err);
            notifyMutationError(err, 'errors.comment_edit', 'Error editant el comentari');
        }
    };

    const toggleResolved = async (comment) => {
        try {
            const res = await axios.patch(`/api/vault/pages/${pageId}/comments/${comment.id}`, {
                resolved: !comment.resolved,
            });
            setComments(prev => prev.map(c => (c.id === comment.id ? res.data : c)));
        } catch (err) {
            console.error('Error changing comment status:', err);
            notifyMutationError(err, 'errors.comment_resolve', 'Error actualitzant el comentari');
        }
    };

    const doDelete = async () => {
        const target = deleteTarget;
        if (!target) return;
        try {
            await axios.delete(`/api/vault/pages/${pageId}/comments/${target.id}`);
            setComments(prev => prev.filter(c => c.id !== target.id));
        } catch (err) {
            console.error('Error deleting comment:', err);
            notifyMutationError(err, 'errors.comment_delete', 'Error eliminant el comentari');
        } finally {
            setDeleteTarget(null);
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[9998] flex justify-end animate-in fade-in duration-150">
            <div className="absolute inset-0 bg-black/30" onClick={onClose} />
            <div
                ref={panelRef}
                className="relative w-full max-w-md h-full bg-[var(--bg-primary)] border-l border-[var(--border-primary)] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
                role="dialog"
                aria-modal="true"
            >
                <div className="px-5 py-4 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-secondary)]">
                    <div className="flex items-center gap-2 min-w-0">
                        <MessageSquare size={18} className="text-[var(--gnosi-blue)] shrink-0" />
                        <div className="min-w-0">
                            <h3 className="text-base font-bold text-[var(--text-primary)] truncate">
                                {t('shell.view_comments', "Comments")}
                            </h3>
                            {pageTitle && (
                                <p className="text-xs text-[var(--text-tertiary)] truncate">{pageTitle}</p>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} className="gnosi-close-btn" aria-label={t('common.close', "Close")}>
                        <X />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-3">
                    {loading ? (
                        <div className="flex items-center justify-center py-12 text-[var(--text-tertiary)]">
                            <Loader2 size={18} className="animate-spin mr-2" />
                            {t('common.loading', "Loading...")}
                        </div>
                    ) : comments.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-[var(--text-tertiary)]">
                            <MessageSquare size={28} className="mb-2 opacity-40" />
                            <p className="text-sm">{t('comments.empty', "No comments yet")}</p>
                        </div>
                    ) : (
                        comments.map((c) => (
                            <div
                                key={c.id}
                                className={`rounded-lg border p-3 ${c.resolved
                                    ? 'border-emerald-500/30 bg-emerald-500/5'
                                    : 'border-[var(--border-primary)] bg-[var(--bg-secondary)]/40'}`}
                            >
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{c.author}</span>
                                        <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">{fmtWhen(c.created_at)}</span>
                                        {c.resolved && (
                                            <span className="text-[9px] uppercase font-bold text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded shrink-0">
                                                {t('comments.resolved', "Resolved")}
                                            </span>
                                        )}
                                    </div>
                                    {canComment && (
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            onClick={() => toggleResolved(c)}
                                            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-emerald-600"
                                            title={c.resolved ? t('comments.reopen', "Reopen") : t('comments.resolve', "Mark as resolved")}
                                        >
                                            {c.resolved ? <RotateCcw size={13} /> : <Check size={13} />}
                                        </button>
                                        <button
                                            onClick={() => { setEditingId(c.id); setEditDraft(c.body); }}
                                            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                                            title={t('common.edit', "Edit")}
                                        >
                                            <Pencil size={13} />
                                        </button>
                                        <button
                                            onClick={() => setDeleteTarget(c)}
                                            className="p-1 rounded hover:bg-red-500/10 text-[var(--text-tertiary)] hover:text-red-600"
                                            title={t('common.delete', "Delete")}
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                    )}
                                </div>
                                {editingId === c.id ? (
                                    <div className="mt-2">
                                        <textarea
                                            value={editDraft}
                                            onChange={(e) => setEditDraft(e.target.value)}
                                            rows={3}
                                            className="w-full px-2 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--gnosi-blue)]/30"
                                        />
                                        <div className="flex justify-end gap-2 mt-2">
                                            <button
                                                onClick={() => { setEditingId(null); setEditDraft(''); }}
                                                className="px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] rounded"
                                            >
                                                {t('common.cancel', "Cancel")}
                                            </button>
                                            <button
                                                onClick={() => saveEdit(c.id)}
                                                disabled={!editDraft.trim()}
                                                className="px-3 py-1 text-xs font-medium text-white bg-[var(--gnosi-blue)] rounded hover:opacity-90 disabled:opacity-50"
                                            >
                                                {t('common.save', "Save")}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words">{c.body}</p>
                                )}
                            </div>
                        ))
                    )}
                </div>

                <div className="border-t border-[var(--border-primary)] p-3 bg-[var(--bg-secondary)]/50">
                    {!canComment ? (
                        <p className="text-xs text-[var(--text-tertiary)] italic text-center py-1">
                            {t('comments.read_only', "Your role only allows reading comments")}
                        </p>
                    ) : (
                    <div className="flex items-end gap-2">
                        <textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                    e.preventDefault();
                                    submitComment();
                                }
                            }}
                            rows={2}
                            placeholder={t('comments.placeholder', "Write a comment… (⌘+Enter to send)")}
                            className="flex-1 px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--gnosi-blue)]/30 resize-none"
                        />
                        <button
                            onClick={submitComment}
                            disabled={!draft.trim() || submitting}
                            className="p-2.5 rounded-lg bg-[var(--gnosi-blue)] text-white hover:opacity-90 disabled:opacity-40 shrink-0"
                            title={t('comments.send', "Send")}
                        >
                            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                        </button>
                    </div>
                    )}
                </div>
            </div>

            <ConfirmModal
                isOpen={Boolean(deleteTarget)}
                title={t('comments.delete_title', "Delete comment")}
                message={t('comments.delete_msg', "Are you sure you want to delete this comment?")}
                confirmText={t('common.delete', "Delete")}
                isDestructive
                onConfirm={doDelete}
                onClose={() => setDeleteTarget(null)}
            />
        </div>
    );
}

export default PageComments;
