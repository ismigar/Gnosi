import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { MessageSquarePlus, Check, Trash2, X, MessageSquare } from 'lucide-react';
import { toast } from '../../lib/toast';
import { useApi } from '../../hooks/use-api';

/**
 * InlineComments
 * Comments anchored to a text selection (Google Docs / Notion style).
 *   - Floating "Comment" button when there's a selection inside the editor.
 *   - Composer popover that captures the selected text as a quote + the
 *     `block_id` of the block (to scroll to it afterward).
 *   - Side panel with all comments (resolve / delete / go to it).
 *
 * Backend: `/api/vault/pages/{id}/inline-comments` (vault-first sidecar).
 * Mounted with `pageId`; the panel opens/closes with the `gnosi:toggle-comments` event.
 * Viewers can only read the thread: the backend returns 403 on
 * mutations (PR #742) and no write action is shown to them here.
 */
export default function InlineComments({ pageId }) {
    const { t } = useTranslation();
    const { role } = useApi();
    const canComment = role !== 'viewer';
    const [comments, setComments] = useState([]);
    const [panelOpen, setPanelOpen] = useState(false);
    const [btn, setBtn] = useState(null);     // {top,left} of the floating button
    const [compose, setCompose] = useState(null); // {top,left,quote,blockId}
    const [draft, setDraft] = useState('');
    const composeRef = useRef(null);

    const load = useCallback(async () => {
        if (!pageId) { setComments([]); return; }
        try { const r = await axios.get(`/api/vault/pages/${pageId}/inline-comments`); setComments(r.data || []); }
        catch { setComments([]); }
    }, [pageId]);

    useEffect(() => { load(); }, [load]);

    // Toggling the panel from outside (VaultShell / command palette).
    useEffect(() => {
        const onToggle = () => setPanelOpen((v) => !v);
        window.addEventListener('gnosi:toggle-comments', onToggle);
        return () => window.removeEventListener('gnosi:toggle-comments', onToggle);
    }, []);

    // Detects text selection inside the editor and shows the floating button.
    // Viewers cannot create comments: no listener and no button.
    useEffect(() => {
        if (!pageId || !canComment) return undefined;
        const onUp = () => {
            setTimeout(() => {
                const sel = window.getSelection();
                if (!sel || sel.isCollapsed || !sel.toString().trim()) { setBtn(null); return; }
                const anchor = sel.anchorNode;
                const el = anchor?.nodeType === 3 ? anchor.parentElement : anchor;
                if (!el || !el.closest || !el.closest('.ProseMirror')) { setBtn(null); return; }
                if (el.closest('[data-gnosi-portal]')) return; // inside the popover
                const rect = sel.getRangeAt(0).getBoundingClientRect();
                setBtn({ top: rect.top - 38, left: rect.left + rect.width / 2 - 60 });
            }, 10);
        };
        document.addEventListener('mouseup', onUp);
        document.addEventListener('keyup', onUp);
        return () => { document.removeEventListener('mouseup', onUp); document.removeEventListener('keyup', onUp); };
    }, [pageId, canComment]);

    // Reports mutation errors: 403 → permissions message; otherwise → generic.
    const notifyMutationError = useCallback((err, key, fallback) => {
        if (err?.response?.status === 403) {
            toast.error(t('errors.comment_forbidden', { defaultValue: "Your role does not allow modifying comments" }));
        } else {
            toast.error(t(key, { defaultValue: fallback }));
        }
    }, [t]);

    const startCompose = (e) => {
        e.preventDefault();
        const sel = window.getSelection();
        const quote = sel ? sel.toString().trim() : '';
        if (!quote) return;
        const anchor = sel.anchorNode;
        const el = anchor?.nodeType === 3 ? anchor.parentElement : anchor;
        const blockId = el?.closest?.('.bn-block[data-id]')?.getAttribute('data-id') || '';
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        setCompose({ top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 320), quote, blockId });
        setBtn(null);
        setDraft('');
        setTimeout(() => composeRef.current?.focus(), 30);
    };

    const submitComment = async () => {
        if (!draft.trim() || !compose) return;
        try {
            await axios.post(`/api/vault/pages/${pageId}/inline-comments`, {
                quote: compose.quote, comment: draft.trim(), block_id: compose.blockId,
            });
            setCompose(null); setDraft(''); setPanelOpen(true); load();
        } catch (err) {
            notifyMutationError(err, 'errors.comment_add', 'Error afegint el comentari');
        }
    };

    const resolve = async (c) => {
        try { await axios.patch(`/api/vault/pages/${pageId}/inline-comments/${c.id}`, { resolved: !c.resolved }); load(); }
        catch (err) { notifyMutationError(err, 'errors.comment_resolve', 'Error actualitzant el comentari'); }
    };
    const remove = async (c) => {
        try { await axios.delete(`/api/vault/pages/${pageId}/inline-comments/${c.id}`); load(); }
        catch (err) { notifyMutationError(err, 'errors.comment_delete', 'Error eliminant el comentari'); }
    };
    const goTo = (c) => {
        if (!c.block_id) return;
        const el = document.querySelector(`.bn-block[data-id="${c.block_id}"]`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.style.transition = 'background-color .3s';
            el.style.backgroundColor = 'var(--gnosi-primary, #6366f1)22';
            setTimeout(() => { el.style.backgroundColor = ''; }, 1200);
        }
    };

    if (!pageId) return null;
    const open = comments.filter((c) => !c.resolved);

    return (
        <>
            {/* Floating button on selection (write-enabled roles only) */}
            {canComment && btn && createPortal(
                <button
                    data-gnosi-portal="comment-btn"
                    onMouseDown={startCompose}
                    style={{ position: 'fixed', top: btn.top, left: btn.left, zIndex: 9998 }}
                    className="flex items-center gap-1 rounded-full bg-[var(--gnosi-primary)] px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:opacity-90"
                >
                    <MessageSquarePlus size={14} /> {t('inline_comments.add', "Comment")}
                </button>, document.body)}

            {/* Composer popover (write-enabled roles only) */}
            {canComment && compose && createPortal(
                <div
                    data-gnosi-portal="comment-compose"
                    style={{ position: 'fixed', top: compose.top, left: compose.left, width: 300, zIndex: 9999 }}
                    className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2.5 shadow-xl"
                >
                    <div className="mb-2 line-clamp-2 border-l-2 border-[var(--gnosi-primary)] pl-2 text-xs italic text-[var(--text-tertiary)]">«{compose.quote}»</div>
                    <textarea
                        ref={composeRef}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitComment(); } if (e.key === 'Escape') setCompose(null); }}
                        placeholder={t('inline_comments.placeholder', "Write a comment…")}
                        className="h-20 w-full resize-y rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                    />
                    <div className="mt-1.5 flex justify-end gap-2">
                        <button onMouseDown={(e) => { e.preventDefault(); setCompose(null); }} className="rounded px-2 py-1 text-xs text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]">{t('common.cancel', "Cancel")}</button>
                        <button onMouseDown={(e) => { e.preventDefault(); submitComment(); }} className="rounded bg-[var(--gnosi-primary)] px-2.5 py-1 text-xs font-medium text-white">{t('inline_comments.add', "Comment")}</button>
                    </div>
                </div>, document.body)}

            {/* Panell lateral */}
            {panelOpen && createPortal(
                <div className="fixed right-0 top-0 z-[140] flex h-full w-80 flex-col border-l border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl">
                    <div className="flex items-center justify-between border-b border-[var(--border-primary)] px-4 py-3">
                        <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><MessageSquare size={16} /> {t('inline_comments.title', "Comments ({{count}})", { count: open.length })}</span>
                        <button onClick={() => setPanelOpen(false)} className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"><X size={16} /></button>
                    </div>
                    <div className="flex-1 overflow-auto p-3">
                        {comments.length === 0 ? (
                            <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
                                {canComment
                                    ? t('inline_comments.empty', "Select text and click “Comment” to add one.")
                                    : t('comments.empty', "No comments yet")}
                            </div>
                        ) : comments.map((c) => (
                            <div key={c.id} className={`mb-2 rounded-lg border p-2.5 ${c.resolved ? 'border-[var(--border-primary)] opacity-60' : 'border-[var(--border-primary)]'}`}>
                                {c.quote && <button onClick={() => goTo(c)} className="mb-1 block w-full border-l-2 border-[var(--gnosi-primary)] pl-2 text-left text-xs italic text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]">«{c.quote}»</button>}
                                <div className={`text-sm text-[var(--text-primary)] ${c.resolved ? 'line-through' : ''}`}>{c.comment}</div>
                                {canComment && (
                                    <div className="mt-1.5 flex items-center gap-2">
                                        <button onClick={() => resolve(c)} title={c.resolved ? t('inline_comments.reopen', "Reopen") : t('inline_comments.resolve', "Resolve")} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--gnosi-primary)]"><Check size={12} /> {c.resolved ? t('inline_comments.reopen', "Reopen") : t('inline_comments.resolve', "Resolve")}</button>
                                        <button onClick={() => remove(c)} title={t('inline_comments.delete', "Delete")} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--gnosi-danger,#dc2626)]"><Trash2 size={12} /></button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>, document.body)}
        </>
    );
}
