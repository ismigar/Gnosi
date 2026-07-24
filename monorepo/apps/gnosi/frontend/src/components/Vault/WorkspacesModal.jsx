import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutPanelLeft, Plus, Trash2, X, FolderOpen } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

/**
 * WorkspacesModal — Saved workspaces (saved layouts).
 * Saves the set of open tabs under a name and can reopen them.
 * Local persistence (localStorage); each workspace = list of {id, isTable, title}.
 * Only pages and tables are saved (PDFs/drawings are omitted in v1).
 */
const KEY = 'gnosi.workspaces';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const save = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 30))); } catch { /* noop */ } };
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

export default function WorkspacesModal({ isOpen, onClose, currentTabs = [], onRestore }) {
    const { t } = useTranslation();
    const [items, setItems] = useState(load);
    const [name, setName] = useState('');
    const panelRef = React.useRef(null);
    useModalKeyboard({ isOpen, onClose, containerRef: panelRef, trapFocus: true });

    if (!isOpen) return null;

    const saveable = (currentTabs || []).filter((t) => !t.isPdf && !t.isDrawing).map((t) => ({ id: t.id, isTable: !!t.isTable, title: t.title || 'Sense títol' }));

    const saveCurrent = () => {
        if (!name.trim() || saveable.length === 0) return;
        const next = [{ id: uid(), name: name.trim(), tabs: saveable }, ...items].slice(0, 30);
        setItems(next); save(next); setName('');
    };
    const remove = (id) => { const next = items.filter((w) => w.id !== id); setItems(next); save(next); };
    const restore = (w) => { onRestore?.(w.tabs || []); onClose(); };

    return (
        <div className="fixed inset-0 z-[150] flex items-start justify-center px-4 pt-[14vh]">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></div>
            <div ref={panelRef} className="relative w-full max-w-md overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl">
                <div className="flex items-center justify-between border-b border-[var(--border-primary)] px-4 py-3">
                    <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><LayoutPanelLeft size={16} /> {t('doc_tabs.workspaces_title', "Workspaces")}</span>
                    <button onClick={onClose} className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"><X size={16} /></button>
                </div>
                <div className="border-b border-[var(--border-primary)] p-3">
                    <div className="flex gap-2">
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveCurrent(); }}
                            placeholder={t('doc_tabs.workspaces_save_placeholder', "Save the {{count}} open tabs as…", { count: saveable.length })}
                            className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gnosi-primary)]"
                        />
                        <button onClick={saveCurrent} disabled={!name.trim() || saveable.length === 0} className="flex items-center gap-1 rounded-lg bg-[var(--gnosi-primary)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                            <Plus size={15} /> {t('common.save', "Save")}
                        </button>
                    </div>
                </div>
                <div className="max-h-80 overflow-auto p-2">
                    {items.length === 0 ? (
                        <div className="px-3 py-8 text-center text-sm text-[var(--text-tertiary)]">{t('doc_tabs.workspaces_empty', "No saved workspaces yet.")}</div>
                    ) : items.map((w) => (
                        <div key={w.id} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-[var(--bg-secondary)]">
                            <button onClick={() => restore(w)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                                <FolderOpen size={15} className="shrink-0 text-[var(--text-tertiary)]" />
                                <span className="truncate text-sm text-[var(--text-primary)]">{w.name}</span>
                                <span className="shrink-0 text-xs text-[var(--text-tertiary)]">{(w.tabs || []).length}</span>
                            </button>
                            <button onClick={() => remove(w.id)} title={t('common.erase', "Delete")} className="rounded p-1 text-[var(--text-tertiary)] hover:text-[var(--gnosi-danger,#dc2626)]"><Trash2 size={14} /></button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
