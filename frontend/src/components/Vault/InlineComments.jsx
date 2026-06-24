import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { MessageSquarePlus, Check, Trash2, X, MessageSquare } from 'lucide-react';

/**
 * InlineComments
 * Comentaris ancorats a una selecció de text (estil Google Docs / Notion).
 *   - Botó flotant «Comenta» quan hi ha una selecció dins l'editor.
 *   - Popover de redacció que captura el text seleccionat com a cita + el
 *     `block_id` del bloc (per fer-hi scroll després).
 *   - Panell lateral amb tots els comentaris (resoldre / esborrar / anar-hi).
 *
 * Backend: `/api/vault/pages/{id}/inline-comments` (sidecar vault-first).
 * Es munta amb `pageId`; el panell s'obre/tanca amb l'event `gnosi:toggle-comments`.
 */
export default function InlineComments({ pageId }) {
    const [comments, setComments] = useState([]);
    const [panelOpen, setPanelOpen] = useState(false);
    const [btn, setBtn] = useState(null);     // {top,left} del botó flotant
    const [compose, setCompose] = useState(null); // {top,left,quote,blockId}
    const [draft, setDraft] = useState('');
    const composeRef = useRef(null);

    const load = useCallback(async () => {
        if (!pageId) { setComments([]); return; }
        try { const r = await axios.get(`/api/vault/pages/${pageId}/inline-comments`); setComments(r.data || []); }
        catch { setComments([]); }
    }, [pageId]);

    useEffect(() => { load(); }, [load]);

    // Toggle del panell des de fora (VaultShell / paleta de comandes).
    useEffect(() => {
        const onToggle = () => setPanelOpen((v) => !v);
        window.addEventListener('gnosi:toggle-comments', onToggle);
        return () => window.removeEventListener('gnosi:toggle-comments', onToggle);
    }, []);

    // Detecta selecció de text dins l'editor i mostra el botó flotant.
    useEffect(() => {
        if (!pageId) return undefined;
        const onUp = () => {
            setTimeout(() => {
                const sel = window.getSelection();
                if (!sel || sel.isCollapsed || !sel.toString().trim()) { setBtn(null); return; }
                const anchor = sel.anchorNode;
                const el = anchor?.nodeType === 3 ? anchor.parentElement : anchor;
                if (!el || !el.closest || !el.closest('.ProseMirror')) { setBtn(null); return; }
                if (el.closest('[data-gnosi-portal]')) return; // dins del popover
                const rect = sel.getRangeAt(0).getBoundingClientRect();
                setBtn({ top: rect.top - 38, left: rect.left + rect.width / 2 - 60 });
            }, 10);
        };
        document.addEventListener('mouseup', onUp);
        document.addEventListener('keyup', onUp);
        return () => { document.removeEventListener('mouseup', onUp); document.removeEventListener('keyup', onUp); };
    }, [pageId]);

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
        } catch { /* noop */ }
    };

    const resolve = async (c) => {
        try { await axios.patch(`/api/vault/pages/${pageId}/inline-comments/${c.id}`, { resolved: !c.resolved }); load(); } catch { /* noop */ }
    };
    const remove = async (c) => {
        try { await axios.delete(`/api/vault/pages/${pageId}/inline-comments/${c.id}`); load(); } catch { /* noop */ }
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
            {/* Botó flotant a la selecció */}
            {btn && createPortal(
                <button
                    data-gnosi-portal="comment-btn"
                    onMouseDown={startCompose}
                    style={{ position: 'fixed', top: btn.top, left: btn.left, zIndex: 9998 }}
                    className="flex items-center gap-1 rounded-full bg-[var(--gnosi-primary)] px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:opacity-90"
                >
                    <MessageSquarePlus size={14} /> Comenta
                </button>, document.body)}

            {/* Popover de redacció */}
            {compose && createPortal(
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
                        placeholder="Escriu un comentari…"
                        className="h-20 w-full resize-y rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                    />
                    <div className="mt-1.5 flex justify-end gap-2">
                        <button onMouseDown={(e) => { e.preventDefault(); setCompose(null); }} className="rounded px-2 py-1 text-xs text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]">Cancel·la</button>
                        <button onMouseDown={(e) => { e.preventDefault(); submitComment(); }} className="rounded bg-[var(--gnosi-primary)] px-2.5 py-1 text-xs font-medium text-white">Comenta</button>
                    </div>
                </div>, document.body)}

            {/* Panell lateral */}
            {panelOpen && createPortal(
                <div className="fixed right-0 top-0 z-[140] flex h-full w-80 flex-col border-l border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl">
                    <div className="flex items-center justify-between border-b border-[var(--border-primary)] px-4 py-3">
                        <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><MessageSquare size={16} /> Comentaris ({open.length})</span>
                        <button onClick={() => setPanelOpen(false)} className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"><X size={16} /></button>
                    </div>
                    <div className="flex-1 overflow-auto p-3">
                        {comments.length === 0 ? (
                            <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">Selecciona text i clica «Comenta» per afegir-ne.</div>
                        ) : comments.map((c) => (
                            <div key={c.id} className={`mb-2 rounded-lg border p-2.5 ${c.resolved ? 'border-[var(--border-primary)] opacity-60' : 'border-[var(--border-primary)]'}`}>
                                {c.quote && <button onClick={() => goTo(c)} className="mb-1 block w-full border-l-2 border-[var(--gnosi-primary)] pl-2 text-left text-xs italic text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]">«{c.quote}»</button>}
                                <div className={`text-sm text-[var(--text-primary)] ${c.resolved ? 'line-through' : ''}`}>{c.comment}</div>
                                <div className="mt-1.5 flex items-center gap-2">
                                    <button onClick={() => resolve(c)} title={c.resolved ? 'Reobre' : 'Resol'} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--gnosi-primary)]"><Check size={12} /> {c.resolved ? 'Reobre' : 'Resol'}</button>
                                    <button onClick={() => remove(c)} title="Esborra" className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--gnosi-danger,#dc2626)]"><Trash2 size={12} /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>, document.body)}
        </>
    );
}
