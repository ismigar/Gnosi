import React, { useState, useCallback } from 'react';
import { Columns, FileText, Clock, Calendar, CheckSquare, Link as LinkIcon } from 'lucide-react';
import { useVaultViewData } from '../../hooks/useVaultViewData';
import { getFieldType, getSchemaFieldNames, getFieldConfig } from './schemaUtils';
import { normalizeOptions, optionColorHex } from './optionCatalogUtils';
import { isMainView } from './viewConstants';
import { VaultViewToolbar } from './VaultViewToolbar';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';

export function VaultKanban({ notes, onNoteSelect, isEmbedded = false, activeView = {}, onUpdateView, onEditSchema, onCreateRecord, schema = {}, idToTitle = {}, onDeleteSelected, onDeletePage, searchTerm: externalSearchTerm }) {
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

    // Propietats visibles a les targetes (mateix criteri que la galeria): la
    // vista principal mostra tots els camps; una vista amb selecció, els seus
    // `visibleProperties` (o els 3 primers per defecte). Abans el kanban
    // ignorava `visibleProperties` i només pintava tags + data de modificació.
    const cardProperties = isMainView(activeView, [activeView].filter(Boolean))
        ? getSchemaFieldNames(schema)
        : (activeView?.visibleProperties || getSchemaFieldNames(schema).slice(0, 3));
    const cardColumns = cardProperties
        .map(prop => [prop, getFieldType(schema, prop)])
        .filter(([key, type]) => type && type !== 'title');

    const normalizeKey = (k) => String(k).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/gi, '');
    const getCardVal = (note, key) => {
        let val = note.metadata?.[key];
        if (val === undefined || val === null || val === '') {
            const keyNorm = normalizeKey(key);
            const metaKey = Object.keys(note.metadata || {}).find(k => normalizeKey(k) === keyNorm);
            if (metaKey) val = note.metadata[metaKey];
        }
        return val;
    };
    const renderCardValue = (value, type) => {
        switch (type) {
            case 'checkbox':
                return <CheckSquare size={13} className={value ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />;
            case 'date':
                return <span className="inline-flex items-center gap-1"><Calendar size={11} />{(() => { try { return new Date(value).toLocaleDateString(); } catch { return String(value); } })()}</span>;
            case 'status':
            case 'select':
                return <span className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-secondary)]">{value}</span>;
            case 'multi_select':
            case 'relation': {
                const items = Array.isArray(value) ? value : String(value).split(',').map(s => s.trim()).filter(Boolean);
                return (
                    <span className="inline-flex flex-wrap gap-1">
                        {items.slice(0, 4).map((it, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]">{idToTitle[it] || (String(it).length > 16 ? String(it).slice(0, 8) + '…' : it)}</span>
                        ))}
                        {items.length > 4 && <span className="text-[var(--text-tertiary)]">+{items.length - 4}</span>}
                    </span>
                );
            }
            case 'url':
                return <span className="inline-flex items-center gap-1 text-[var(--gnosi-primary)]"><LinkIcon size={11} />URL</span>;
            default:
                return <span>{String(value)}</span>;
        }
    };

    // Ordre i color de les columnes: si el camp d'agrupació té opcions definides
    // a l'esquema (select/status), les columnes segueixen el seu ORDRE i n'hereten
    // el COLOR (com Notion). Abans l'ordre era fix ('Idea/Brollador/…') i sense
    // color. Fallback: els valors trobats als registres.
    const groupConfig = getFieldConfig(schema, groupBy);
    const groupOptions = Array.isArray(groupConfig?.options) ? normalizeOptions(groupConfig.options) : [];
    const optionColorMap = {};
    groupOptions.forEach(o => { optionColorMap[o.name] = o.color; });
    const columnColor = (status) => (optionColorMap[status] ? optionColorHex(optionColorMap[status]) : null);
    const predefinedStatuses = groupOptions.length > 0
        ? groupOptions.map(o => o.name)
        : (groupBy === 'status' ? ['Idea', 'Brollador', 'Zettel', 'Tancat'] : []);

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
                                <h3 className="font-bold text-[var(--text-secondary)] text-[10px] tracking-wider uppercase bg-[var(--bg-primary)] px-2.5 py-1 rounded-lg shadow-sm border border-[var(--border-primary)] inline-flex items-center gap-1.5">
                                    {columnColor(status) && <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: columnColor(status) }} />}
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

                                        {cardColumns.length > 0 && (
                                            <div className="flex flex-col gap-1 mt-2 text-[10px]">
                                                {cardColumns.map(([key, type], pi) => {
                                                    const val = getCardVal(note, key);
                                                    if (val === undefined || val === null || val === '') return null;
                                                    return (
                                                        <div key={`${key}-${pi}`} className="flex items-center gap-1.5 overflow-hidden min-h-[16px]">
                                                            <span className="font-medium uppercase tracking-wider text-[var(--text-tertiary)] shrink-0 truncate max-w-[45%]">{key}</span>
                                                            <div className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{renderCardValue(val, type)}</div>
                                                        </div>
                                                    );
                                                })}
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
