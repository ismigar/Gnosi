import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Pencil, Check, Loader2 } from 'lucide-react';
import { VaultMarkdown } from './VaultMarkdown';

/**
 * SyncedBlock
 * Bidirectional synced block (Notion synced block style). The content lives
 * in a shared source (`/api/vault/synced/{sync_id}`); editing any
 * instance updates the source and all other instances reflect it
 * LIVE: within the same window (event) and across tabs/windows of the app
 * (BroadcastChannel). Saved to Markdown as a ```gnosi-synced fence with the sync_id.
 * (Cross-device would require pushing via the collaboration WS — out of scope for v1.)
 */

// Cross-tab channel: propagates changes to all tabs/windows of
// the app on the same origin (not just the current window).
const _syncChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('gnosi-synced') : null;

// REAL-TIME push between DEVICES via SSE (/api/vault/synced-events): a
// single EventSource shared across the whole app; each synced block subscribes to it.
const _sseListeners = new Set();
let _sse = null;
const ensureSyncedSSE = () => {
    if (_sse || typeof EventSource === 'undefined') return;
    try {
        _sse = new EventSource('/api/vault/synced-events');
        _sse.onmessage = (e) => {
            let d; try { d = JSON.parse(e.data); } catch { return; }
            if (d?.syncId) _sseListeners.forEach((fn) => { try { fn(d.syncId); } catch { /* noop */ } });
        };
        // EventSource reconnects on its own on error; no need to close it.
    } catch { _sse = null; }
};
export default function SyncedBlock({ block }) {
    const { t } = useTranslation();
    const syncId = String(block?.props?.sync_id || '').trim();
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        if (!syncId) { setLoading(false); return; }
        setLoading(true);
        try { const r = await axios.get(`/api/vault/synced/${syncId}`); setContent(r.data?.content || ''); }
        catch { setContent(''); }
        finally { setLoading(false); }
    }, [syncId]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setDraft(content); }, [content]);

    const save = async () => {
        setSaving(true);
        try {
            await axios.put(`/api/vault/synced/${syncId}`, { content: draft });
            setContent(draft);
            setEditing(false);
            // Same window (other instances) + other tabs/windows.
            window.dispatchEvent(new CustomEvent('gnosi:synced-updated', { detail: { syncId } }));
            try { _syncChannel?.postMessage({ syncId }); } catch { /* noop */ }
        } catch { /* noop */ } finally { setSaving(false); }
    };

    // Reloads if another instance with the same sync_id has been saved: same
    // window (event), another tab (BroadcastChannel) or another
    // DISPOSITIU (SSE en temps real).
    useEffect(() => {
        const onUpd = (e) => { if (e.detail?.syncId === syncId && !editing) load(); };
        const onMsg = (e) => { if (e.data?.syncId === syncId && !editing) load(); };
        const onSse = (sid) => { if (sid === syncId && !editing) load(); };
        window.addEventListener('gnosi:synced-updated', onUpd);
        _syncChannel?.addEventListener('message', onMsg);
        ensureSyncedSSE();
        _sseListeners.add(onSse);
        return () => {
            window.removeEventListener('gnosi:synced-updated', onUpd);
            _syncChannel?.removeEventListener('message', onMsg);
            _sseListeners.delete(onSse);
        };
    }, [syncId, editing, load]);

    return (
        <div className="bn-synced group/synced relative my-3 rounded-lg border-l-2 border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/5 py-2 pl-3 pr-3" contentEditable={false}>
            <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--gnosi-primary)]">
                    <RefreshCw size={11} /> {t('editor.synced_block_label', 'Bloc sincronitzat')}
                </span>
                {!editing ? (
                    <button onClick={() => setEditing(true)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[var(--text-tertiary)] opacity-0 transition-opacity hover:text-[var(--gnosi-primary)] group-hover/synced:opacity-100">
                        <Pencil size={12} /> {t('common.edit', 'Edita')}
                    </button>
                ) : (
                    <button onClick={save} disabled={saving} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10">
                        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {t('editor.synced_done', 'Fet')}
                    </button>
                )}
            </div>
            {loading ? (
                <div className="py-2 text-sm text-[var(--text-tertiary)]">{t('common.loading', 'Carregant…')}</div>
            ) : editing ? (
                <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); } }}
                    placeholder={t('editor.synced_placeholder', 'Contingut compartit (Markdown)…')}
                    autoFocus
                    className="h-32 w-full resize-y rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                />
            ) : content.trim() ? (
                <div className="text-[var(--text-primary)]"><VaultMarkdown md={content} /></div>
            ) : (
                <div className="py-1 text-sm italic text-[var(--text-tertiary)]">{t('editor.synced_empty', 'Bloc sincronitzat buit — clica «Edita» per afegir-hi contingut.')}</div>
            )}
        </div>
    );
}
