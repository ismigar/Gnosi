import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { RefreshCw, Pencil, Check, Loader2 } from 'lucide-react';
import { VaultMarkdown } from './VaultMarkdown';

/**
 * SyncedBlock
 * Bloc sincronitzat bidireccional (estil Notion synced block). El contingut viu
 * en una font compartida (`/api/vault/synced/{sync_id}`); editar qualsevol
 * instància actualitza la font i totes les altres instàncies la reflecteixen
 * (en recarregar / en el següent render). Es desa a Markdown com a fence
 * ```gnosi-synced amb el sync_id.
 */
export default function SyncedBlock({ block }) {
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
            // Avisa altres instàncies de la mateixa font (mateixa pàgina) perquè recarreguin.
            window.dispatchEvent(new CustomEvent('gnosi:synced-updated', { detail: { syncId } }));
        } catch { /* noop */ } finally { setSaving(false); }
    };

    // Recarrega si una altra instància del mateix sync_id s'ha desat.
    useEffect(() => {
        const onUpd = (e) => { if (e.detail?.syncId === syncId && !editing) load(); };
        window.addEventListener('gnosi:synced-updated', onUpd);
        return () => window.removeEventListener('gnosi:synced-updated', onUpd);
    }, [syncId, editing, load]);

    return (
        <div className="bn-synced group/synced relative my-3 rounded-lg border-l-2 border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/5 py-2 pl-3 pr-3" contentEditable={false}>
            <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--gnosi-primary)]">
                    <RefreshCw size={11} /> Bloc sincronitzat
                </span>
                {!editing ? (
                    <button onClick={() => setEditing(true)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[var(--text-tertiary)] opacity-0 transition-opacity hover:text-[var(--gnosi-primary)] group-hover/synced:opacity-100">
                        <Pencil size={12} /> Edita
                    </button>
                ) : (
                    <button onClick={save} disabled={saving} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10">
                        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Fet
                    </button>
                )}
            </div>
            {loading ? (
                <div className="py-2 text-sm text-[var(--text-tertiary)]">Carregant…</div>
            ) : editing ? (
                <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); } }}
                    placeholder="Contingut compartit (Markdown)…"
                    autoFocus
                    className="h-32 w-full resize-y rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                />
            ) : content.trim() ? (
                <div className="text-[var(--text-primary)]"><VaultMarkdown md={content} /></div>
            ) : (
                <div className="py-1 text-sm italic text-[var(--text-tertiary)]">Bloc sincronitzat buit — clica «Edita» per afegir-hi contingut.</div>
            )}
        </div>
    );
}
