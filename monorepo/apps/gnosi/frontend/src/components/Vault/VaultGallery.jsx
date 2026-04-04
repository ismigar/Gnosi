import React, { useState, useCallback } from 'react';
import { FileText, Tag, Calendar, Link as LinkIcon, Type, CheckSquare } from 'lucide-react';
import { IconRenderer } from './IconRenderer';
import { useVaultViewData } from '../../hooks/useVaultViewData';
import { VaultViewToolbar } from './VaultViewToolbar';
import { getFieldType, getSchemaFieldNames } from './schemaUtils';
import { isMainView } from './viewConstants';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';

export function VaultGallery({ notes, onNoteSelect, schema = {}, idToTitle = {}, activeView = {}, onUpdateView, onEditSchema, onCreateRecord, onDeleteSelected, onDeletePage, searchTerm: externalSearchTerm }) {
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

    // ---- SELECCIÓ MÚLTIPLE ----
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

    // La vista principal sempre mostra totes les propietats.
    const visibleProperties = isMainView(activeView, [activeView].filter(Boolean))
        ? getSchemaFieldNames(schema)
        : (activeView.visibleProperties || getSchemaFieldNames(schema).slice(0, 3));
    const dynamicColumns = visibleProperties.map(prop => [prop, getFieldType(schema, prop)]).filter(([key, type]) => type);

    // Apply card size configuration
    const cardSize = activeView.cardSize || 'medium';
    const getGridClass = () => {
        switch (cardSize) {
            case 'small':
                return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8';
            case 'large':
                return 'grid-cols-1 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3';
            case 'medium':
            default:
                return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5';
        }
    };

    const getCardHeightClass = () => {
        switch (cardSize) {
            case 'small':
                return 'h-40';
            case 'large':
                return 'h-80';
            case 'medium':
            default:
                return 'h-64';
        }
    };

    const getCoverHeightClass = () => {
        switch (cardSize) {
            case 'small':
                return 'h-16';
            case 'large':
                return 'h-48';
            case 'medium':
            default:
                return 'h-32';
        }
    };

    const renderPropertyValue = (value, type) => {
        if (value === undefined || value === null || value === '') return <span className="text-[var(--text-tertiary)] opacity-40">-</span>;

        switch (type) {
            case 'checkbox':
                return <CheckSquare size={12} className={value ? "text-[var(--gnosi-primary)]" : "text-[var(--text-tertiary)]"} />;
            case 'date':
                return (
                    <div className="flex items-center gap-1 whitespace-nowrap text-[10px] text-[var(--text-secondary)]">
                        <Calendar size={12} className="text-[var(--text-tertiary)]" />
                        <span>{new Date(value).toLocaleDateString()}</span>
                    </div>
                );
            case 'status':
            case 'select':
                return (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-primary)] truncate max-w-full inline-block">
                        {value}
                    </span>
                );
            case 'multi_select':
            case 'relation': {
                const items = Array.isArray(value) ? value : String(value).split(',').map(s => s.trim());
                return (
                    <div className="flex flex-wrap gap-1 max-w-full overflow-hidden h-4">
                        {items.slice(0, 2).map((it, idx) => (
                            <span key={idx} className="px-1.5 py-0 rounded-sm text-[10px] font-medium bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] whitespace-nowrap truncate max-w-full block" title={it}>
                                {idToTitle[it] || it}
                            </span>
                        ))}
                        {items.length > 2 && <span className="text-[10px] text-[var(--text-tertiary)]">+{items.length - 2}</span>}
                    </div>
                );
            }
            case 'url':
                return (
                    <a href={value} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[var(--gnosi-primary)] hover:underline flex items-center gap-1 truncate text-xs">
                        <LinkIcon size={12} /> URL
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
                        className="inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-500 hover:bg-emerald-500/20"
                        title={String(value)}
                    >
                        <LinkIcon size={12} /> Zotero
                    </button>
                );
            default:
                return <span className="truncate text-xs block text-[var(--text-secondary)]" title={value}>{value}</span>;
        }
    };

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
                    isEmbedded={false}
                />
            )}

            {/* Barra d'accions en bulk */}
            {selectedIds.size > 0 && (
                <VaultBulkActionsBar
                    selectedIds={selectedIds}
                    totalCount={sortedAndFilteredNotes.length}
                    onSelectAll={() => selectAll(sortedAndFilteredNotes.map(n => n.id))}
                    onClearSelection={clearSelection}
                    onDeleteSelected={(onDeleteSelected || onDeletePage) ? handleBulkDelete : null}
                />
            )}

            <div className="flex-1 overflow-y-auto custom-scrollbar px-4 md:px-6 pb-4 md:pb-6 pt-vault-header-top">
                <div className="max-w-[1400px] mx-auto">
                    <div className={`grid ${getGridClass()} gap-6`}>
                        {sortedAndFilteredNotes.map((note, noteIndex) => {
                            const hasCover = !!note.metadata?.cover;
                            return (
                                <div
                                    key={`${note.id || 'note'}-${noteIndex}`}
                                    onClick={() => { if (selectedIds.size > 0) { toggleSelect(note.id, {}); } else { onNoteSelect(note.id); } }}
                                    className={`group relative bg-[var(--bg-primary)] rounded-xl border overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col ${getCardHeightClass()} ${isSelected(note.id) ? 'border-[var(--gnosi-primary)] ring-2 ring-[var(--gnosi-primary)]/20' : 'border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/50'}`}
                                >
                                    {/* Checkbox de selecció (cantonada superior esquerra) */}
                                    <label
                                        className={`absolute top-2 left-2 z-20 cursor-pointer ${isSelected(note.id) || selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                        onClick={(e) => { e.stopPropagation(); toggleSelect(note.id, e); }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isSelected(note.id)}
                                            onChange={(e) => toggleSelect(note.id, e)}
                                            className="w-4 h-4 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)] cursor-pointer bg-[var(--bg-secondary)]/90 shadow-sm"
                                        />
                                    </label>
                                    {/* Cover Area */}
                                    <div className={`${getCoverHeightClass()} relative shrink-0 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]`}>
                                        {hasCover ? (
                                            (() => {
                                                let coverUrl = note.metadata.cover;
                                                if (coverUrl.startsWith('Assets/')) {
                                                    coverUrl = `/api/vault/assets/${coverUrl.substring(7)}`;
                                                }
                                                return (
                                                    <div
                                                        className="absolute inset-0 bg-contain bg-center bg-no-repeat"
                                                        style={{ backgroundImage: `url(${coverUrl})` }}
                                                    />
                                                );
                                            })()
                                        ) : (
                                            <div className="absolute inset-0 bg-gradient-to-br from-[var(--bg-tertiary)] to-[var(--gnosi-primary)]/10" />
                                        )}

                                        {/* Icon overlapping the cover */}
                                        <div className="absolute -bottom-5 left-4 w-10 h-10 bg-[var(--bg-secondary)] rounded-lg shadow-sm border border-[var(--border-primary)] flex items-center justify-center z-10 group-hover:scale-110 transition-transform overflow-hidden">
                                            <IconRenderer icon={note.metadata?.icon} size={24} />
                                        </div>
                                    </div>

                                    {/* Content Area */}
                                    <div className="p-4 pt-6 flex flex-col flex-1 min-h-0">
                                        <h3 className="font-semibold text-[var(--text-primary)] text-sm mb-2 truncate group-hover:text-[var(--gnosi-primary)] transition-colors" title={note.title}>
                                            {note.title || "Sense Títol"}
                                        </h3>

                                        {/* Properties */}
                                        <div className="flex-1 flex flex-col gap-1.5 overflow-hidden">
                                            {dynamicColumns.map(([key, type], propIndex) => {
                                                const normalizeKey = (k) => String(k).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, '');
                                                const keyNorm = normalizeKey(key);

                                                let val = note.metadata?.[key];
                                                if (val === undefined || val === null || val === '') {
                                                    const metaKey = Object.keys(note.metadata || {}).find(k => normalizeKey(k) === keyNorm);
                                                    if (metaKey) val = note.metadata[metaKey];
                                                }

                                                if (val === undefined || val === null || val === '') return null;

                                                return (
                                                    <div key={`${key}-${propIndex}`} className="flex items-center gap-2 text-[var(--text-secondary)] overflow-hidden min-h-[18px]">
                                                        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)] w-16 shrink-0 truncate">{key}</span>
                                                        <div className="flex-1 min-w-0">
                                                            {renderPropertyValue(val, type)}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {sortedAndFilteredNotes.length === 0 && (
                        <div className="w-full h-64 flex flex-col items-center justify-center text-[var(--text-tertiary)]">
                            <FileText size={48} className="mb-4 text-[var(--bg-tertiary)]" strokeWidth={1} />
                            <p>No hi ha registres en aquesta vista.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
