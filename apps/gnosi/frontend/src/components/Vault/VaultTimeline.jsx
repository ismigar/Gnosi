import React, { useMemo, useState, useRef, useCallback } from 'react';
import { FileText, Calendar, Clock, Link as LinkIcon, CheckSquare, ChevronLeft, ChevronRight, ArrowRight, Plus } from 'lucide-react';
import { useVaultViewData } from '../../hooks/useVaultViewData';
import { VaultViewToolbar } from './VaultViewToolbar';
import { getSchemaFieldEntries, getSchemaFieldNames } from './schemaUtils';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';

export function VaultTimeline({ notes, onNoteSelect, onUpdateNote, schema = {}, idToTitle = {}, activeView = {}, onUpdateView, onEditSchema, onCreateRecord, onDeleteSelected, onDeletePage, searchTerm: externalSearchTerm }) {
    const scrollContainerRef = useRef(null);
    const [zoomLevel, setZoomLevel] = useState('month'); // 'day', 'week', 'month'
    const [selectingPredecessorFor, setSelectingPredecessorFor] = useState(null);
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

    // Filtrem la propietat 'title' de l'esquema
    const dynamicColumns = getSchemaFieldEntries(schema).filter(([key, type]) => type !== 'title').slice(0, 3);

    const datePropertyFound = useMemo(() =>
        getSchemaFieldEntries(schema).find(([key, type]) => type === 'date')?.[0]
        , [schema]);

    const endPropertyFound = useMemo(() => {
        const endKeys = ['due_date', 'end_date', 'data de venciment', 'venciment'];
        return getSchemaFieldNames(schema).find(k => endKeys.includes(k.toLowerCase()));
    }, [schema]);

    // Lògica de dades per al Gantt
    const { chartData, timeScale } = useMemo(() => {
        const processedNotes = sortedAndFilteredNotes.map(note => {
            let startDateStr = note.last_modified;
            let endDateStr = null;

            if (datePropertyFound) {
                const aliasMap = {
                    "date added": "created_time",
                    "date modified": "last_edited_time"
                };
                const normalizeKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/gi, '');
                const schemaKeyNorm = normalizeKey(datePropertyFound);
                const targetKeyNorm = aliasMap[schemaKeyNorm] ? normalizeKey(aliasMap[schemaKeyNorm]) : schemaKeyNorm;
                const metaKey = note.metadata ? Object.keys(note.metadata).find(k => normalizeKey(k) === targetKeyNorm) || datePropertyFound : datePropertyFound;

                if (note.metadata?.[metaKey] && !isNaN(new Date(note.metadata[metaKey]).getTime())) {
                    startDateStr = note.metadata[metaKey];
                }

                if (endPropertyFound && note.metadata?.[endPropertyFound]) {
                    endDateStr = note.metadata[endPropertyFound];
                }
            }

            const start = new Date(startDateStr);
            const end = endDateStr ? new Date(endDateStr) : new Date(start.getTime() + 24 * 60 * 60 * 1000);

            return {
                ...note,
                start,
                end: isNaN(end.getTime()) ? new Date(start.getTime() + 24 * 60 * 60 * 1000) : end
            };
        }).filter(n => !isNaN(n.start.getTime()));

        if (processedNotes.length === 0) return { chartData: [], timeScale: null };

        // Trobar rang total
        const minDate = new Date(Math.min(...processedNotes.map(n => n.start.getTime())));
        const maxDate = new Date(Math.max(...processedNotes.map(n => n.end.getTime())));

        const chartStart = new Date(minDate);
        chartStart.setDate(1);
        const chartEnd = new Date(maxDate);
        chartEnd.setMonth(chartEnd.getMonth() + 2);

        const months = [];
        let curr = new Date(chartStart);
        while (curr <= chartEnd) {
            months.push(new Date(curr));
            curr.setMonth(curr.getMonth() + 1);
        }

        return {
            chartData: processedNotes.sort((a, b) => a.start - b.start),
            timeScale: { start: chartStart, end: chartEnd, months }
        };
    }, [sortedAndFilteredNotes, schema, datePropertyFound, endPropertyFound]);

    const calculatePosition = (date) => {
        if (!timeScale) return 0;
        const totalMs = timeScale.end - timeScale.start;
        const currentMs = date - timeScale.start;
        return (currentMs / totalMs) * 100;
    };

    const handleUpdateDates = async (noteId, newStart, newEnd) => {
        if (!onUpdateNote) return;

        const note = chartData.find(n => n.id === noteId);
        if (!note) return;

        const metadata = { ...(note.metadata || {}) };
        if (datePropertyFound) metadata[datePropertyFound] = newStart.toISOString();
        if (endPropertyFound) metadata[endPropertyFound] = newEnd.toISOString();

        // Recursivitat per successores
        const updatedNotes = recalculateSuccessors(noteId, newStart, newEnd, chartData);

        // Desem els canvis de la nota actual i les afectades
        for (const updatedNote of updatedNotes) {
            const upMetadata = { ...(updatedNote.metadata || {}) };
            if (datePropertyFound) upMetadata[datePropertyFound] = updatedNote.start.toISOString();
            if (endPropertyFound) upMetadata[endPropertyFound] = updatedNote.end.toISOString();
            await onUpdateNote(updatedNote.id, { metadata: upMetadata });
        }
    };

    const recalculateSuccessors = (updatedNoteId, newStart, newEnd, allProcessedNotes) => {
        const affected = [];
        const note = allProcessedNotes.find(n => n.id === updatedNoteId);
        if (!note) return affected;

        const successors = allProcessedNotes.filter(n =>
            n.metadata?.predecessor_ids?.includes(updatedNoteId)
        );

        successors.forEach(succ => {
            const minStart = new Date(newEnd);
            if (succ.start < minStart) {
                const duration = succ.end - succ.start;
                const newSuccStart = new Date(minStart);
                const newSuccEnd = new Date(minStart.getTime() + duration);

                const succCopy = { ...succ, start: newSuccStart, end: newSuccEnd };
                affected.push(succCopy);

                // Recurrence
                const subAffected = recalculateSuccessors(succ.id, newSuccStart, newSuccEnd, allProcessedNotes.map(n => n.id === succ.id ? succCopy : n));
                affected.push(...subAffected);
            }
        });

        // Unique by ID (keep latest update)
        const unique = Array.from(new Map(affected.map(item => [item.id, item])).values());
        return unique;
    };

    const handleAddPredecessor = async (noteId, predId) => {
        const note = notes.find(n => n.id === noteId);
        if (!note || !onUpdateNote) return;

        const predecessors = [...(note.metadata?.predecessor_ids || [])];
        if (!predecessors.includes(predId)) {
            predecessors.push(predId);
            const metadata = { ...note.metadata, predecessor_ids: predecessors };
            await onUpdateNote(noteId, { metadata });

            // Recalculem dates immediatament
            const predNote = chartData.find(n => n.id === predId);
            const currentProcessed = chartData.find(n => n.id === noteId);
            if (predNote && currentProcessed) {
                const minStart = new Date(predNote.end);
                if (currentProcessed.start < minStart) {
                    const duration = currentProcessed.end - currentProcessed.start;
                    const newStart = new Date(minStart);
                    const newEnd = new Date(minStart.getTime() + duration);
                    await handleUpdateDates(noteId, newStart, newEnd);
                }
            }
        }
        setSelectingPredecessorFor(null);
    };

    const scroll = (direction) => {
        if (scrollContainerRef.current) {
            const amount = direction === 'left' ? -300 : 300;
            scrollContainerRef.current.scrollBy({ left: amount, behavior: 'smooth' });
        }
    };

    return (
        <div className="w-full h-full flex flex-col bg-[var(--bg-secondary)] overflow-hidden relative">
            {/* Selector de Predecessores Overlay */}
            {selectingPredecessorFor && (
                <div className="absolute inset-0 bg-black/60 z-[100] flex items-center justify-center p-4">
                    <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
                        <h3 className="text-lg font-bold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                            <ArrowRight size={20} className="text-[var(--gnosi-primary)]" />
                            Selecciona una Antecessora
                        </h3>
                        <p className="text-sm text-[var(--text-secondary)] mb-4">
                            Tria quin registre ha de finalitzar abans que <strong>{idToTitle[selectingPredecessorFor]}</strong> pugui començar.
                        </p>
                        <div className="max-h-64 overflow-y-auto border border-[var(--border-primary)] rounded-lg">
                            {chartData.filter(n => n.id !== selectingPredecessorFor).map(n => (
                                <button
                                    key={n.id}
                                    onClick={() => handleAddPredecessor(selectingPredecessorFor, n.id)}
                                    className="w-full px-4 py-3 text-left hover:bg-[var(--bg-secondary)] border-b border-[var(--border-primary)] last:border-0 flex items-center justify-between group transition-colors"
                                >
                                    <span className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--gnosi-primary)]">
                                        {n.title || "Sense Títol"}
                                    </span>
                                    <span className="text-[10px] text-[var(--text-tertiary)]">
                                        Fins al {n.end.toLocaleDateString()}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <div className="mt-6 flex justify-end">
                            <button
                                onClick={() => setSelectingPredecessorFor(null)}
                                className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] rounded-lg transition-colors"
                            >
                                Cancel·lar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* BARRA D'EINES UNIFICADA */}
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
                    extraActions={
                        <div className="flex items-center gap-2 ml-4">
                            <button
                                onClick={() => scroll('left')}
                                className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-md text-[var(--text-tertiary)] transition-colors border border-[var(--border-primary)]"
                            >
                                <ChevronLeft size={14} />
                            </button>
                            <button
                                onClick={() => scroll('right')}
                                className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-md text-[var(--text-tertiary)] transition-colors border border-[var(--border-primary)]"
                            >
                                <ChevronRight size={14} />
                            </button>

                            <div className="flex bg-[var(--bg-tertiary)] p-1 rounded-lg border border-[var(--border-primary)] ml-2">
                                {['day', 'week', 'month'].map((level) => (
                                    <button
                                        key={level}
                                        onClick={() => setZoomLevel(level)}
                                        className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded transition-all ${zoomLevel === level
                                            ? 'bg-[var(--bg-primary)] text-[var(--gnosi-primary)] shadow-sm'
                                            : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                                            }`}
                                    >
                                        {level === 'day' ? 'Dia' : level === 'week' ? 'Set' : 'Mes'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    }
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

            {/* Gantt Area */}
            <div className="flex-1 overflow-hidden flex flex-col">
                <div
                    ref={scrollContainerRef}
                    className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar relative bg-[var(--bg-primary)] pt-vault-header-top"
                >
                    {/* Time Scale Header */}
                    <div className="sticky top-0 z-10 flex min-w-full bg-[var(--bg-secondary)] border-b border-[var(--border-primary)] h-10 shadow-sm">
                        <div className="w-64 shrink-0 border-r border-[var(--border-primary)] bg-[var(--bg-secondary)] flex items-center px-4 font-bold text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
                            Títol del Registre
                        </div>
                        <div className="flex-1 relative min-w-[3000px]">
                            {timeScale?.months.map((month, idx) => {
                                const left = calculatePosition(month);
                                const nextMonth = new Date(month);
                                nextMonth.setMonth(nextMonth.getMonth() + 1);
                                const width = calculatePosition(nextMonth) - left;

                                return (
                                    <div
                                        key={idx}
                                        style={{ left: `${left}%`, width: `${width}%` }}
                                        className="absolute h-full border-r border-[var(--border-primary)] flex items-center px-3 text-[10px] font-bold text-[var(--text-secondary)] truncate bg-[var(--bg-secondary)]"
                                    >
                                        {month.toLocaleString('ca-ES', { month: 'short', year: 'numeric' }).toUpperCase()}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Grid and Rows */}
                    <div className="relative min-w-full min-h-full">
                        {/* Vertical Grid Lines */}
                        <div className="absolute inset-0 flex pointer-events-none">
                            <div className="w-64 shrink-0 border-r border-[var(--border-primary)]" />
                            <div className="flex-1 relative min-w-[3000px]">
                                {timeScale?.months.map((month, idx) => (
                                    <div
                                        key={idx}
                                        style={{ left: `${calculatePosition(month)}%` }}
                                        className="absolute h-full border-r border-[var(--border-primary)]"
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Rows */}
                        <div className="relative z-0">
                            {chartData.map((note) => {
                                const startPos = calculatePosition(note.start);
                                const endPos = calculatePosition(note.end);
                                const width = Math.max(endPos - startPos, 0.5);
                                const icon = note.metadata?.icon || <FileText size={16} className="text-slate-400" />;
                                const predecessors = note.metadata?.predecessor_ids || [];

                                return (
                                    <div
                                        key={note.id}
                                        className="flex border-b border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]/50 transition-colors group h-12"
                                    >
                                        {/* Label Area */}
                                        <div
                                            className={`w-64 shrink-0 border-r border-[var(--border-primary)] px-4 flex items-center gap-2 cursor-pointer overflow-hidden z-10 sticky left-0 ${isSelected(note.id) ? 'bg-[var(--gnosi-primary)]/10' : 'bg-[var(--bg-primary)]'}`}
                                            onClick={() => onNoteSelect(note.id)}
                                        >
                                            <label
                                                className="cursor-pointer inline-flex items-center"
                                                onClick={(e) => { e.stopPropagation(); toggleSelect(note.id, e); }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected(note.id)}
                                                    onChange={(e) => toggleSelect(note.id, e)}
                                                    className="w-3.5 h-3.5 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)] cursor-pointer bg-[var(--bg-secondary)]"
                                                />
                                            </label>
                                            <div className="shrink-0 w-6 h-6 rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] flex items-center justify-center text-xs">
                                                <FileText size={14} className="text-[var(--text-tertiary)]" />
                                            </div>
                                            <div className="flex flex-col min-w-0 flex-1">
                                                <span className="font-semibold text-[var(--text-primary)] text-xs truncate group-hover:text-[var(--gnosi-primary)] transition-colors">
                                                    {note.title || "Sense Títol"}
                                                </span>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[9px] text-[var(--text-tertiary)] font-medium">
                                                        {note.start.toLocaleDateString('ca-ES', { day: 'numeric', month: 'short' })}
                                                    </span>
                                                </div>
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectingPredecessorFor(note.id);
                                                }}
                                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[var(--gnosi-primary)]/10 rounded text-[var(--gnosi-primary)] transition-all"
                                                title="Afegir antecessora"
                                            >
                                                <Plus size={12} />
                                            </button>
                                        </div>

                                        {/* Timeline Bar Area */}
                                        <div className="flex-1 relative min-w-[3000px] h-full flex items-center px-0">
                                            {/* Draw Dependency Lines (Simple) */}
                                            {predecessors.map(predId => {
                                                const pred = chartData.find(n => n.id === predId);
                                                if (!pred) return null;
                                                const predEndPos = calculatePosition(pred.end);
                                                if (predEndPos > startPos) return null;

                                                return (
                                                    <div
                                                        key={`${note.id}-${predId}`}
                                                        className="absolute h-px bg-indigo-200/50 pointer-events-none"
                                                        style={{
                                                            left: `${predEndPos}%`,
                                                            width: `${startPos - predEndPos}%`,
                                                            top: '50%',
                                                            transform: 'translateY(-50%)'
                                                        }}
                                                    />
                                                );
                                            })}

                                            <div
                                                onClick={() => onNoteSelect(note.id)}
                                                className="absolute h-6 rounded-md bg-[var(--gnosi-primary)] shadow-sm border border-[var(--gnosi-primary)]/50 hover:brightness-110 hover:scale-y-105 transition-all cursor-pointer flex items-center px-2 group/bar overflow-hidden"
                                                style={{
                                                    left: `${startPos}%`,
                                                    width: `${width}%`,
                                                    minWidth: '60px'
                                                }}
                                            >
                                                <div className="flex items-center gap-1 text-white min-w-0">
                                                    <span className="text-[10px] font-bold whitespace-nowrap truncate">
                                                        {note.title || "Note"}
                                                    </span>
                                                </div>

                                                {/* Tooltip on hover */}
                                                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-2 bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded shadow-xl text-[10px] opacity-0 group-hover/bar:opacity-100 z-30 pointer-events-none transition-opacity whitespace-nowrap font-medium border border-[var(--border-primary)]">
                                                    <strong>{note.title}</strong><br />
                                                    {note.start.toLocaleDateString()} - {note.end.toLocaleDateString()}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {chartData.length === 0 && (
                    <div className="w-full h-64 flex flex-col items-center justify-center text-[var(--text-tertiary)]">
                        <Calendar size={48} className="mb-4 text-[var(--bg-tertiary)]" strokeWidth={1} />
                        <p>No hi ha dades per mostrar al cronograma.</p>
                    </div>
                )}
            </div>

            {/* Legend / Footer */}
            <div className="px-6 py-2 border-t border-[var(--border-primary)] bg-[var(--bg-primary)] flex items-center justify-between text-[10px] font-medium text-[var(--text-tertiary)]">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded bg-[var(--gnosi-primary)]" />
                        <span>Pàgina / Tarea</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-bold text-[var(--gnosi-primary)]">
                        <ArrowRight size={10} />
                        <span>Dependències actives ({chartData.length} registres)</span>
                    </div>
                </div>
                <div>
                    Cronograma interactiu amb dependències automàtiques.
                </div>
            </div>
        </div>
    );
}
