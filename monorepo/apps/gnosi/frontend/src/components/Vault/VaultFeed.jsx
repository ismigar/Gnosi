import React, { useMemo, useCallback } from 'react';
import { FileText, Calendar, Clock, Link as LinkIcon, CheckSquare } from 'lucide-react';
import { getSchemaFieldEntries } from './schemaUtils';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';

export function VaultFeed({ notes, onNoteSelect, schema = {}, idToTitle = {}, onDeleteSelected, onDeletePage, searchTerm = '' }) {

    // Totes les propietats dinàmiques excepte el títol
    const dynamicColumns = getSchemaFieldEntries(schema).filter(([key, type]) => type !== 'title');

    const renderPropertyValue = (value, type) => {
        if (value === undefined || value === null || value === '') return null;

        switch (type) {
            case 'checkbox':
                return <CheckSquare size={14} className={value ? "text-indigo-500" : "text-[var(--text-tertiary)]"} />;
            case 'date':
                return (
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-sm">
                        <Calendar size={14} className="text-[var(--text-tertiary)]" />
                        <span className="text-[var(--text-secondary)]">{new Date(value).toLocaleDateString()}</span>
                    </div>
                );
            case 'status':
            case 'select':
                return (
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-primary)]">
                        {value}
                    </span>
                );
            case 'multi_select':
            case 'relation':
                const items = Array.isArray(value) ? value : String(value).split(',').map(s => s.trim());
                return (
                    <div className="flex flex-wrap gap-1.5">
                        {items.map((it, idx) => (
                            <span key={idx} className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-500/10 text-indigo-400">
                                {idToTitle[it] || it}
                            </span>
                        ))}
                    </div>
                );
            case 'url':
                return (
                    <a href={value} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-indigo-500 hover:text-indigo-600 hover:underline flex items-center gap-1 text-sm truncate max-w-sm">
                        <LinkIcon size={14} /> URL
                    </a>
                );
            case 'zotero':
                return (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            fetch('/api/vault/open-resource', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    zotero_uri: String(value).trim().startsWith('zotero://') ? String(value).trim() : null,
                                    file_path: String(value).trim().startsWith('zotero://') ? null : String(value).trim(),
                                }),
                            });
                        }}
                        className="inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-500 hover:bg-emerald-500/20"
                        title={String(value)}
                    >
                        <LinkIcon size={14} /> Obrir Zotero
                    </button>
                );
            default:
                return <span className="text-sm text-[var(--text-primary)]">{value}</span>;
        }
    };

    // Filtrem per terme de cerca si n'hi ha
    const filteredNotes = useMemo(() => {
        if (!searchTerm) return notes;
        const term = searchTerm.toLowerCase();
        return notes.filter(note => {
            const titleMatch = (note.title || '').toLowerCase().includes(term);
            const contentMatch = (note.content || '').toLowerCase().includes(term);
            const metadataMatch = Object.values(note.metadata || {}).some(val =>
                String(val).toLowerCase().includes(term)
            );
            return titleMatch || contentMatch || metadataMatch;
        });
    }, [notes, searchTerm]);

    // Ordenem per la data d'última modificació, de més recent a més antiga
    const sortedNotes = useMemo(() => {
        return [...filteredNotes].sort((a, b) => {
            return new Date(b.last_modified).getTime() - new Date(a.last_modified).getTime();
        });
    }, [filteredNotes]);

    const { selectedIds, isSelected, toggleSelect, selectAll, clearSelection } = useVaultSelection(sortedNotes);

    const handleBulkDelete = useCallback(() => {
        if (selectedIds.size === 0) return;
        if (onDeleteSelected) {
            onDeleteSelected(new Set(selectedIds));
            clearSelection();
        } else if (onDeletePage) {
            const safeNotes = notes || [];
            selectedIds.forEach(id => {
                const note = safeNotes.find(n => n.id === id);
                if (note) onDeletePage(id, note.title);
            });
            clearSelection();
        }
    }, [selectedIds, onDeleteSelected, onDeletePage, notes, clearSelection]);

    useVaultSelectionShortcuts({
        selectedCount: selectedIds.size,
        onClearSelection: clearSelection,
        onDeleteSelection: handleBulkDelete,
    });

    if (sortedNotes.length === 0) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-tertiary)] p-10 bg-[var(--bg-secondary)]">
                <FileText size={48} className="mb-4 text-[var(--bg-tertiary)]" strokeWidth={1} />
                <p>No hi ha publicacions al feed.</p>
            </div>
        );
    }

    return (
        <div className="w-full h-full pt-vault-header-top px-4 md:px-6 pb-4 md:pb-6 overflow-y-auto custom-scrollbar bg-[var(--bg-secondary)] flex flex-col items-center">
            {selectedIds.size > 0 && (
                <VaultBulkActionsBar
                        selectedIds={selectedIds}
                    totalCount={sortedNotes.length}
                    onSelectAll={() => selectAll(sortedNotes.map(n => n.id))}
                    onClearSelection={clearSelection}
                    onDeleteSelected={(onDeleteSelected || onDeletePage) ? handleBulkDelete : null}
                    className="w-full max-w-2xl mb-4 shrink-0 bg-[var(--gnosi-primary)]/10 border border-[var(--gnosi-primary)]/20 rounded-lg px-4 py-2 flex items-center gap-3 text-sm z-30"
                />
            )}
            <div className="w-full max-w-2xl flex flex-col gap-8 pb-16">

                {sortedNotes.map(note => {
                    const hasCover = !!note.metadata?.cover;
                    const icon = note.metadata?.icon || <FileText size={24} className="text-[var(--text-tertiary)]" />;

                    return (
                        <div
                            key={note.id}
                            onClick={() => { if (selectedIds.size > 0) toggleSelect(note.id, {}); else onNoteSelect(note.id); }}
                            className={`relative bg-[var(--bg-primary)] rounded-2xl shadow-sm border overflow-hidden hover:shadow-md transition-all cursor-pointer group flex flex-col ${isSelected(note.id) ? 'border-[var(--gnosi-primary)] ring-2 ring-[var(--gnosi-primary)]/20' : 'border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/50'}`}
                        >
                            <label
                                className={`absolute top-3 left-3 z-20 cursor-pointer ${isSelected(note.id) || selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                onClick={(e) => { e.stopPropagation(); toggleSelect(note.id, e); }}
                            >
                                <input
                                    type="checkbox"
                                    checked={isSelected(note.id)}
                                    onChange={(e) => toggleSelect(note.id, e)}
                                    className="w-4 h-4 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)] cursor-pointer bg-[var(--bg-secondary)]/90 shadow-sm"
                                />
                            </label>
                            {/* Feed Item Header / Cover */}
                            <div className="w-full h-48 sm:h-64 relative bg-[var(--bg-tertiary)] flex-shrink-0">
                                {hasCover ? (
                                    <div
                                        className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
                                        style={{ backgroundImage: `url(${note.metadata.cover})` }}
                                    />
                                ) : (
                                    <div className="absolute inset-0 bg-gradient-to-br from-[var(--gnosi-primary)]/10 to-[var(--bg-tertiary)]" />
                                )}

                                {/* Gradient overlay for text legibility if we wanted to overlay the title, 
                                    but we're placing it below like a standard feed card */}
                            </div>

                            {/* Feed Item Body */}
                            <div className="p-6 relative bg-[var(--bg-primary)]">
                                {/* Profile / Icon Overlap */}
                                <div className="absolute -top-8 left-6 w-16 h-16 bg-[var(--bg-secondary)] rounded-xl shadow-sm border border-[var(--border-primary)] flex items-center justify-center text-3xl z-10 transition-transform group-hover:scale-110">
                                    {typeof icon === 'string' ? icon : icon}
                                </div>

                                <div className="mt-8 flex flex-col gap-4">
                                    <div>
                                        <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-1 leading-tight group-hover:text-[var(--gnosi-primary)] transition-colors">
                                            {note.title || "Sense Títol"}
                                        </h2>
                                        <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-tertiary)]">
                                            <Clock size={12} />
                                            <span>
                                                Actualitzat el {new Date(note.last_modified).toLocaleDateString('ca-ES', {
                                                    day: 'numeric', month: 'long', year: 'numeric',
                                                    hour: '2-digit', minute: '2-digit'
                                                })}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Properties Grid */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6 mt-2 pt-4 border-t border-[var(--border-primary)]">
                                        {dynamicColumns.map(([key, type]) => {
                                            const aliasMap = {
                                                "date added": "created_time",
                                                "date modified": "last_edited_time"
                                            };
                                            const normalizeKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/gi, '');
                                            const schemaKeyNorm = normalizeKey(key);
                                            const targetKeyNorm = aliasMap[schemaKeyNorm] ? normalizeKey(aliasMap[schemaKeyNorm]) : schemaKeyNorm;

                                            const originalMetaKey = note.metadata ? (Object.keys(note.metadata).find(k => normalizeKey(k) === targetKeyNorm) || key) : key;
                                            const val = note.metadata?.[originalMetaKey];

                                            const renderedVal = renderPropertyValue(val, type);
                                            if (!renderedVal) return null;

                                            return (
                                                <div key={key} className="flex flex-col gap-1">
                                                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
                                                        {key}
                                                    </span>
                                                    <div>
                                                        {renderedVal}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Action footer */}
                                    <div className="mt-2 pt-4 flex justify-end">
                                        <span className="text-sm font-semibold text-[var(--gnosi-primary)] opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1">
                                            Llegir sencer &rarr;
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
