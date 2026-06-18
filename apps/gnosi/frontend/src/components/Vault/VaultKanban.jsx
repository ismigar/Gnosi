import React, { useState, useCallback } from 'react';
import { Columns, FileText, Tag, Clock } from 'lucide-react';
import { useVaultViewData } from '../../hooks/useVaultViewData';
import { VaultViewToolbar } from './VaultViewToolbar';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';

export function VaultKanban({ notes, onNoteSelect, isEmbedded = false, activeView = {}, onUpdateView, onEditSchema, onCreateRecord, schema = {}, onDeleteSelected, onDeletePage, searchTerm: externalSearchTerm }) {
    const [internalSearchTerm, setInternalSearchTerm] = useState('');
    const searchTerm = externalSearchTerm !== undefined ? externalSearchTerm : internalSearchTerm;
    const setSearchTerm = externalSearchTerm !== undefined ? () => { } : setInternalSearchTerm;

    // ---- LÒGICA DE DADES UNIFICADA (FITRES, SORT, SEARCH) ----
    const viewConfig = {
        filters: activeView?.filters || [],
        sorts: activeView?.sort || { field: "last_modified", direction: "desc" },
        search: searchTerm
    };

    const { sortedPages: sortedAndFilteredNotes } = useVaultViewData({ pages: notes, schema, view: viewConfig, searchTerm });
    const { selectedIds, isSelected, toggleSelect, selectAll, clearSelection } = useVaultSelection(sortedAndFilteredNotes);

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

    // Definir columna d'agrupament
    const groupBy = activeView?.groupBy || 'status';

    // Definir columnes fixes per defecte (basat en el que s'ofereix al BlockEditor)
    const predefinedStatuses = groupBy === 'status' ? ['Idea', 'Brollador', 'Zettel', 'Tancat'] : [];

    const customStatuses = new Set();
    sortedAndFilteredNotes.forEach(note => {
        const s = note.metadata?.[groupBy];
        if (s && !predefinedStatuses.includes(s)) {
            customStatuses.add(s);
        }
    });

    const allStatuses = [...predefinedStatuses, ...Array.from(customStatuses), 'Sense Estat'];

    // Agrupar notes per estat/propietat
    const groupedNotes = allStatuses.reduce((acc, status) => {
        acc[status] = [];
        return acc;
    }, {});

    sortedAndFilteredNotes.forEach(note => {
        const status = note.metadata?.[groupBy] || 'Sense Estat';
        if (groupedNotes[status]) {
            groupedNotes[status].push(note);
        } else {
            groupedNotes['Sense Estat'].push(note);
        }
    });

    return (
        <div className="w-full h-full flex flex-col bg-[var(--bg-secondary)] overflow-hidden">
            {externalSearchTerm === undefined && (
                <VaultViewToolbar
                    search={searchTerm}
                    onSearchChange={setSearchTerm}
                    onToggleFilters={() => onEditSchema?.('filters')}
                    onToggleSorts={() => onEditSchema?.('sorts')}
                    onAddNew={onCreateRecord}
                    activeFiltersCount={Array.isArray(activeView?.filters) ? activeView.filters.length : (activeView?.filters?.conditions?.length || 0)}
                    activeSortsCount={Array.isArray(activeView?.sort) ? activeView.sort.length : (activeView?.sort ? 1 : 0)}
                    isEmbedded={isEmbedded}
                />
            )}

            {selectedIds.size > 0 && (
                <VaultBulkActionsBar
                    selectedIds={selectedIds}
                    totalCount={sortedAndFilteredNotes.length}
                    onSelectAll={() => selectAll(sortedAndFilteredNotes.map(n => n.id))}
                    onClearSelection={clearSelection}
                    onDeleteSelected={(onDeleteSelected || onDeletePage) ? handleBulkDelete : null}
                />
            )}

            <div className={`flex-1 overflow-x-auto overflow-y-auto custom-scrollbar ${isEmbedded ? '' : 'px-4 md:px-6 pb-4 md:pb-6 pt-vault-header-top'}`}>
                {!isEmbedded && (
                    <h1 className="text-2xl font-bold mb-6 text-[var(--text-primary)] flex items-center gap-3 sticky left-0">
                        <Columns size={24} className="text-[var(--gnosi-primary)]" />
                        {activeView?.name || "Tauler Kanban"}
                        <span className="text-sm font-normal text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-full ml-2">
                            {sortedAndFilteredNotes.length} registres
                        </span>
                    </h1>
                )}

                <div className="flex gap-6 min-w-max pb-8 items-start">
                    {allStatuses.map(status => (
                        <div key={status} className="w-80 flex flex-col bg-[var(--bg-tertiary)]/50 rounded-xl p-3 shadow-sm border border-[var(--border-primary)]">
                            <div className="flex justify-between items-center mb-4 px-1">
                                <h3 className="font-bold text-[var(--text-secondary)] text-[10px] tracking-wider uppercase bg-[var(--bg-primary)] px-2.5 py-1 rounded-lg shadow-sm border border-[var(--border-primary)]">
                                    {status}
                                </h3>
                                <span className="text-[10px] font-bold text-[var(--text-tertiary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded-md border border-[var(--border-primary)]/50">
                                    {groupedNotes[status]?.length || 0}
                                </span>
                            </div>

                            <div className="flex flex-col gap-3">
                                {groupedNotes[status]?.map(note => (
                                    <div
                                        key={note.id}
                                        onClick={() => { if (selectedIds.size > 0) toggleSelect(note.id, {}); else onNoteSelect(note.id); }}
                                        className={`relative bg-[var(--bg-primary)] p-4 rounded-xl shadow-sm border cursor-pointer hover:shadow-md transition-all group ${isSelected(note.id) ? 'border-[var(--gnosi-primary)] ring-2 ring-[var(--gnosi-primary)]/20 shadow-indigo-500/5' : 'border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/50'}`}
                                    >
                                        <label
                                            className={`absolute top-2 left-2 z-10 cursor-pointer ${isSelected(note.id) || selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                            onClick={(e) => { e.stopPropagation(); toggleSelect(note.id, e); }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected(note.id)}
                                                onChange={(e) => toggleSelect(note.id, e)}
                                                className="w-4 h-4 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)] cursor-pointer bg-[var(--bg-primary)]/90 shadow-sm"
                                            />
                                        </label>
                                            <h4 className="font-semibold text-[var(--text-primary)] mb-2 group-hover:text-[var(--gnosi-primary)] transition-colors flex items-start gap-2 text-sm leading-snug">
                                            <FileText size={16} className="mt-0.5 text-[var(--text-tertiary)] group-hover:text-[var(--gnosi-primary)]/70 shrink-0" />
                                            <span>{note.title || "Sense Títol"}</span>
                                        </h4>

                                        {note.metadata?.tags && (
                                            <div className="flex items-center gap-1 mt-3 text-[10px] text-[var(--text-secondary)] overflow-hidden bg-[var(--bg-tertiary)]/50 px-1.5 py-0.5 rounded border border-[var(--border-primary)]/30 w-fit max-w-full">
                                                <Tag size={12} className="shrink-0 text-[var(--gnosi-primary)]/60" />
                                                <span className="truncate">{note.metadata.tags}</span>
                                            </div>
                                        )}

                                        <div className="flex items-center gap-1 mt-2 text-[10px] text-[var(--text-tertiary)] pt-2 border-t border-[var(--border-primary)]/50">
                                            <Clock size={12} />
                                            <span>{new Date(note.last_modified).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                ))}
                                {groupedNotes[status]?.length === 0 && (
                                    <div className="py-8 text-center text-[10px] text-[var(--text-tertiary)] border-2 border-dashed border-[var(--border-primary)]/50 rounded-xl bg-[var(--bg-secondary)]/30">
                                        Sense registres
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
