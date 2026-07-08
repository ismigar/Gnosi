import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useTitlePreview } from './useTitlePreview';
import { Columns, FileText, Clock, Calendar, CheckSquare, Link as LinkIcon } from 'lucide-react';
import { useVaultViewData } from '../../hooks/useVaultViewData';
import { useLocaleSettings } from '../../hooks/useLocaleSettings';
import { getFieldType, getSchemaFieldNames, getFieldConfig, resolveViewSorts, resolveViewFilters } from './schemaUtils';
import { formatDate, formatNumber, resolveFieldFormat } from './formatUtils';
import { normalizeOptions, optionColorHex } from './optionCatalogUtils';
import { isMainView } from './viewConstants';
import { VaultViewToolbar } from './VaultViewToolbar';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';

// Tipus de camp sobre els quals NO es pot arrossegar (valors derivats o de
// sistema: escriure-hi corrompria el frontmatter o no tindria efecte).
const NON_DRAGGABLE_GROUP_TYPES = new Set(['formula', 'rollup', 'virtual', 'button', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by']);

export function VaultKanban({ notes, onNoteSelect, isEmbedded = false, activeView = {}, onUpdateView, onEditSchema, onCreateRecord, schema = {}, idToTitle = {}, onDeleteSelected, onDeletePage, onUpdateNote, searchTerm: externalSearchTerm }) {
    // Previsualització del contingut en passar el ratolí pel títol d'una targeta.
    const titlePreview = useTitlePreview({ onOpenPage: onNoteSelect });
    const localeSettings = useLocaleSettings();
    const [internalSearchTerm, setInternalSearchTerm] = useState('');
    const searchTerm = externalSearchTerm !== undefined ? externalSearchTerm : internalSearchTerm;
    const setSearchTerm = externalSearchTerm !== undefined ? () => { } : setInternalSearchTerm;

    // ---- LÒGICA DE DADES UNIFICADA (FITRES, SORT, SEARCH) ----
    // L'ordre es resol amb `resolveViewSorts` (clau `sorts` — la que persisteixen
    // l'import de Notion i el modal — amb fallback a la llegada `sort`).
    // Memoitzat: `resolveViewSorts`/`resolveViewFilters` retornen arrays NOUS i
    // sense useMemo el sort/filtrat es recalculava a cada render.
    const viewConfig = useMemo(() => ({
        filters: resolveViewFilters(activeView),
        sorts: resolveViewSorts(activeView, { field: "last_modified", direction: "desc" }),
        search: searchTerm
    }), [activeView, searchTerm]);

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

    // Propietats visibles a les targetes (mateix criteri que la galeria): tota
    // vista amb `visibleProperties` configurats els respecta — TAMBÉ la
    // principal (abans forçava tots els camps i tapava la config real de les
    // vistes importades de Notion). Sense config: la principal mostra tots els
    // camps; una vista custom, els 3 primers per defecte.
    const cardProperties = activeView?.visibleProperties?.length
        ? activeView.visibleProperties
        : (isMainView(activeView)
            ? getSchemaFieldNames(schema)
            : getSchemaFieldNames(schema).slice(0, 3));
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
    const renderCardValue = (value, type, field) => {
        switch (type) {
            case 'checkbox':
                return <CheckSquare size={13} className={value ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />;
            case 'date': {
                const fmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                return <span className="inline-flex items-center gap-1"><Calendar size={11} />{formatDate(value, { dateFormat: fmt.dateFormat, type: 'date', locale: fmt.dateLocale })}</span>;
            }
            case 'number': {
                const fmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                return <span className="tabular-nums">{formatNumber(value, { kind: fmt.kind, decimals: fmt.decimals, currencyCode: fmt.currencyCode, locale: fmt.numberLocale })}</span>;
            }
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

    // ── DRAG & DROP entre columnes ──────────────────────────────────────────
    // Moviments optimistes pendents: noteId → nou valor del camp d'agrupació.
    // La targeta es pinta a la columna destí immediatament; l'entrada es neteja
    // quan el refetch porta el valor ja reflectit (o es reverteix si el PATCH
    // falla). Sense això, la targeta saltava enrere fins al refetch.
    const [pendingMoves, setPendingMoves] = useState(() => new Map());
    const [dragOverCol, setDragOverCol] = useState(null);
    const groupByType = getFieldType(schema, groupBy);
    const canDrag = !!onUpdateNote && !NON_DRAGGABLE_GROUP_TYPES.has(groupByType);

    // Valors d'agrupació d'un registre. Resol la clau de forma tolerant (exacta
    // o normalitzada, com `getCardVal`) i retorna una LLISTA: un camp
    // multi_select/relació és un ARRAY i el registre ha d'aparèixer a CADA
    // columna (com Notion). Abans s'usava la clau exacta i el valor cru, així que
    // un array creava una columna espúria "A,B" i una clau amb prefix decoratiu
    // (emoji) queia tota a 'Sense Estat'.
    const groupValuesOf = (note) => {
        const raw = pendingMoves.has(note.id) ? pendingMoves.get(note.id) : getCardVal(note, groupBy);
        if (Array.isArray(raw)) return raw.map(v => String(v)).filter(Boolean);
        return (raw === undefined || raw === null || String(raw).trim() === '') ? [] : [String(raw)];
    };

    // Neteja els moviments pendents que el prop `notes` ja reflecteix.
    useEffect(() => {
        if (pendingMoves.size === 0) return;
        const norm = (v) => JSON.stringify(Array.isArray(v) ? v.map(String) : (v === undefined || v === null ? '' : String(v)));
        setPendingMoves(prev => {
            let changed = false;
            const next = new Map(prev);
            for (const [id, val] of prev) {
                const note = (notes || []).find(n => n.id === id);
                if (!note) { next.delete(id); changed = true; continue; }
                if (norm(getCardVal(note, groupBy)) === norm(val)) { next.delete(id); changed = true; }
            }
            return changed ? next : prev;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- només reacciona a l'arribada de dades fresques
    }, [notes]);

    const customStatuses = new Set();
    sortedAndFilteredNotes.forEach(note => {
        groupValuesOf(note).forEach(v => {
            if (!predefinedStatuses.includes(v)) customStatuses.add(v);
        });
    });

    // Bucket dels registres SENSE valor: clau sentinella interna (no una
    // etiqueta literal com "Sense Estat") perquè un valor real amb aquest text
    // no col·lisioni: abans generava dues columnes amb la mateixa key de React
    // apuntant al MATEIX bucket (targetes duplicades i recompte inflat).
    const EMPTY_BUCKET = '__gnosi_empty__';
    const allStatuses = [...new Set([...predefinedStatuses, ...Array.from(customStatuses)])].concat(EMPTY_BUCKET);

    // Agrupar notes per estat/propietat
    const groupedNotes = allStatuses.reduce((acc, status) => {
        acc[status] = [];
        return acc;
    }, {});

    sortedAndFilteredNotes.forEach(note => {
        const vals = groupValuesOf(note);
        if (!vals.length) { groupedNotes[EMPTY_BUCKET].push(note); return; }
        vals.forEach(v => {
            (groupedNotes[v] || groupedNotes[EMPTY_BUCKET]).push(note);
        });
    });

    // Deixar anar una targeta sobre una columna: escriu el valor de la columna
    // al camp d'agrupació (com Notion). Multivalor (multi_select/relació):
    // substitueix el valor d'ORIGEN pel de destí (la resta es conserven);
    // columna de buits: neteja el camp. PATCH merge al backend, així només
    // viatja el camp d'agrupació.
    const handleDropOnColumn = async (e, targetStatus) => {
        e.preventDefault();
        setDragOverCol(null);
        if (!canDrag) return;
        let payload = null;
        try { payload = JSON.parse(e.dataTransfer.getData('text/plain') || 'null'); } catch { /* aliè */ }
        if (!payload?.id) return;
        const { id, from } = payload;
        if (from === targetStatus) return;
        const note = sortedAndFilteredNotes.find(n => n.id === id);
        if (!note) return;

        const raw = pendingMoves.has(id) ? pendingMoves.get(id) : getCardVal(note, groupBy);
        let nextValue;
        if (targetStatus === EMPTY_BUCKET) {
            nextValue = Array.isArray(raw) ? [] : '';
        } else if (Array.isArray(raw)) {
            const withoutFrom = raw.map(String).filter(v => v && v !== from);
            nextValue = withoutFrom.includes(targetStatus) ? withoutFrom : [...withoutFrom, targetStatus];
        } else {
            nextValue = targetStatus;
        }

        // Clau REAL del metadata (tolerant, com getCardVal): escriure el nom de
        // l'esquema quan la nota el guarda amb una variant crearia una clau duplicada.
        const keyNorm = normalizeKey(groupBy);
        const metaKey = Object.keys(note.metadata || {}).find(k => normalizeKey(k) === keyNorm) || groupBy;

        setPendingMoves(prev => new Map(prev).set(id, nextValue));
        try {
            await onUpdateNote(id, { metadata: { [metaKey]: nextValue } });
        } catch (err) {
            console.error('Error movent la targeta de columna:', err);
            setPendingMoves(prev => { const m = new Map(prev); m.delete(id); return m; });
        }
    };

    return (
        <div className="w-full h-full flex flex-col bg-[var(--bg-primary)] overflow-hidden">
            {externalSearchTerm === undefined && (
                <VaultViewToolbar
                    search={searchTerm}
                    onSearchChange={setSearchTerm}
                    onToggleFilters={() => onEditSchema?.('filters')}
                    onToggleSorts={() => onEditSchema?.('sorts')}
                    onAddNew={onCreateRecord}
                    activeFiltersCount={resolveViewFilters(activeView).length}
                    activeSortsCount={resolveViewSorts(activeView).length}
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
                        <div
                            key={status}
                            onDragOver={canDrag ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverCol !== status) setDragOverCol(status); } : undefined}
                            onDragLeave={canDrag ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverCol(c => (c === status ? null : c)); } : undefined}
                            onDrop={canDrag ? (e) => handleDropOnColumn(e, status) : undefined}
                            className={`w-80 flex flex-col bg-[var(--bg-tertiary)]/50 rounded-xl p-3 shadow-sm border transition-colors ${dragOverCol === status ? 'border-[var(--gnosi-primary)] ring-2 ring-[var(--gnosi-primary)]/20 bg-[var(--gnosi-primary)]/5' : 'border-[var(--border-primary)]'}`}>
                            <div className="flex justify-between items-center mb-4 px-1">
                                <h3 className="font-bold text-[var(--text-secondary)] text-[10px] tracking-wider uppercase bg-[var(--bg-primary)] px-2.5 py-1 rounded-lg shadow-sm border border-[var(--border-primary)] inline-flex items-center gap-1.5">
                                    {columnColor(status) && <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: columnColor(status) }} />}
                                    {/* Agrupar per un camp RELACIÓ: el valor de columna és l'id de
                                        la pàgina relacionada. `idToTitle` (índex global) el resol a
                                        títol; sense això, la capçalera mostrava l'UUID cru. Per a
                                        select/text l'id no hi és i es queda el valor (opció). */}
                                    {status === EMPTY_BUCKET ? 'Sense Estat' : (idToTitle[status] || status)}
                                </h3>
                                <span className="text-[10px] font-bold text-[var(--text-tertiary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded-md border border-[var(--border-primary)]/50">
                                    {groupedNotes[status]?.length || 0}
                                </span>
                            </div>

                            <div className="flex flex-col gap-3">
                                {groupedNotes[status]?.map(note => (
                                    <div
                                        key={note.id}
                                        draggable={canDrag}
                                        onDragStart={canDrag ? (e) => {
                                            e.dataTransfer.effectAllowed = 'move';
                                            e.dataTransfer.setData('text/plain', JSON.stringify({ id: note.id, from: status }));
                                        } : undefined}
                                        onDragEnd={canDrag ? () => setDragOverCol(null) : undefined}
                                        onClick={() => { if (selectedIds.size > 0) toggleSelect(note.id, {}); else onNoteSelect(note.id); }}
                                        className={`relative bg-[var(--bg-primary)] p-4 rounded-xl shadow-sm border cursor-pointer hover:shadow-md transition-all group ${canDrag ? 'active:cursor-grabbing' : ''} ${isSelected(note.id) ? 'border-[var(--gnosi-primary)] ring-2 ring-[var(--gnosi-primary)]/20 shadow-indigo-500/5' : 'border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/50'}`}
                                    >
                                        <label
                                            className={`absolute top-2 left-2 z-10 cursor-pointer ${isSelected(note.id) || selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                            onClick={(e) => e.stopPropagation()}
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
                                            <span {...titlePreview.getTitleProps(note.id)}>{note.title || "Sense Títol"}</span>
                                        </h4>

                                        {cardColumns.length > 0 && (
                                            <div className="flex flex-col gap-1 mt-2 text-[10px]">
                                                {cardColumns.map(([key, type], pi) => {
                                                    const val = getCardVal(note, key);
                                                    if (val === undefined || val === null || val === '') return null;
                                                    return (
                                                        <div key={`${key}-${pi}`} className="flex items-center gap-1.5 overflow-hidden min-h-[16px]">
                                                            <span className="font-medium uppercase tracking-wider text-[var(--text-tertiary)] shrink-0 truncate max-w-[45%]">{key}</span>
                                                            <div className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{renderCardValue(val, type, key)}</div>
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

            {titlePreview.preview}
        </div>
    );
}
