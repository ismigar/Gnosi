import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
import { RelationItem } from './RelationItem';
import { orderGroupKeys } from './groupOrderUtils';
import {
    normalizeRelationValues,
    unlinkRelationFromRecord,
} from './relationItemUtils';

// Field types on which dragging is NOT allowed (derived values or
// system: writing to it would corrupt the frontmatter or have no effect).
const NON_DRAGGABLE_GROUP_TYPES = new Set(['formula', 'rollup', 'virtual', 'button', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by']);

export function VaultKanban({ notes, onNoteSelect, isEmbedded = false, activeView = {}, onEditSchema, onCreateRecord, schema = {}, idToTitle = {}, onDeleteSelected, onDeletePage, onApplyTemplate, templates = [], onUpdateNote, searchTerm: externalSearchTerm }) {
    const { t } = useTranslation();
    // Content preview when hovering over a card's title.
    const titlePreview = useTitlePreview({ onOpenPage: onNoteSelect });
    const localeSettings = useLocaleSettings();
    const [internalSearchTerm, setInternalSearchTerm] = useState('');
    const searchTerm = externalSearchTerm !== undefined ? externalSearchTerm : internalSearchTerm;
    const setSearchTerm = externalSearchTerm !== undefined ? () => { } : setInternalSearchTerm;

    // ---- UNIFIED DATA LOGIC (FILTERS, SORT, SEARCH) ----
    // The order is resolved with `resolveViewSorts` (the `sorts` key — the one that persist
    // the Notion import and the modal — with fallback to the legacy `sort`).
    // Memoized: `resolveViewSorts`/`resolveViewFilters` return NEW arrays and
    // without useMemo, the sort/filtering was recalculated on every render.
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

    // Define grouping column
    const groupBy = activeView?.groupBy || 'status';

    // Properties visible on the cards (same criterion as the gallery): every
    // view with `visibleProperties` configured respects them — INCLUDING the
    // main one (previously it forced all fields and hid the real config of the
    // views imported from Notion). Without config: the main one shows all the
    // fields; a custom view, the first 3 by default.
    const cardProperties = activeView?.visibleProperties?.length
        ? activeView.visibleProperties
        : (isMainView(activeView)
            ? getSchemaFieldNames(schema)
            : getSchemaFieldNames(schema).slice(0, 3));
    const cardColumns = cardProperties
        .map(prop => [prop, getFieldType(schema, prop)])
        .filter(([, type]) => type && type !== 'title');

    const normalizeKey = (k) => String(k).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/gi, '');
    const getCardValue = (note, key) => {
        let metadataKey = key;
        let val = note.metadata?.[key];
        if (val === undefined || val === null || val === '') {
            const keyNorm = normalizeKey(key);
            const matchedKey = Object.keys(note.metadata || {}).find(k => normalizeKey(k) === keyNorm);
            if (matchedKey) {
                metadataKey = matchedKey;
                val = note.metadata[matchedKey];
            }
        }
        return { value: val, metadataKey };
    };
    const getCardVal = (note, key) => getCardValue(note, key).value;
    const renderCardValue = (value, type, field, note, metadataKey) => {
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
            case 'multi_select': {
                const items = normalizeRelationValues(value);
                return (
                    <span className="inline-flex flex-wrap gap-1">
                        {items.slice(0, 4).map((it, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]">{idToTitle[it] || (String(it).length > 16 ? String(it).slice(0, 8) + '…' : it)}</span>
                        ))}
                        {items.length > 4 && <span className="text-[var(--text-tertiary)]">+{items.length - 4}</span>}
                    </span>
                );
            }
            case 'relation': {
                const items = normalizeRelationValues(value);
                return (
                    <span className="inline-flex flex-wrap gap-1">
                        {items.map(relationId => (
                            <RelationItem
                                key={relationId}
                                relationId={relationId}
                                title={idToTitle[relationId] || relationId}
                                onOpen={onNoteSelect}
                                onRemove={onUpdateNote ? () => unlinkRelationFromRecord({
                                    pageId: note.id,
                                    field,
                                    metadataKey,
                                    value,
                                    relationId,
                                    relationTitle: idToTitle[relationId] || relationId,
                                    onUpdate: onUpdateNote,
                                }) : undefined}
                            />
                        ))}
                    </span>
                );
            }
            case 'url':
                return <span className="inline-flex items-center gap-1 text-[var(--gnosi-primary)]"><LinkIcon size={11} />URL</span>;
            default:
                return <span>{String(value)}</span>;
        }
    };

    // Column order and color: if the grouping field has defined options
    // in the schema (select/status), the columns follow its ORDER and inherit its
    // COLOR (like Notion). Previously the order was fixed ('Idea/Brollador/…') and without
    // color. Fallback: the values found in the records.
    const groupConfig = getFieldConfig(schema, groupBy);
    const groupOptions = Array.isArray(groupConfig?.options) ? normalizeOptions(groupConfig.options) : [];
    const optionColorMap = {};
    groupOptions.forEach(o => { optionColorMap[o.name] = o.color; });
    const columnColor = (status) => (optionColorMap[status] ? optionColorHex(optionColorMap[status]) : null);
    const predefinedStatuses = groupOptions.length > 0
        ? groupOptions.map(o => o.name)
        : (groupBy === 'status' ? ['Idea', 'Brollador', 'Zettel', 'Tancat'] : []);

    // ── DRAG & DROP between columns ──────────────────────────────────────────
    // Pending optimistic moves: noteId → new value of the grouping field.
    // The card is rendered in the destination column immediately; the entry is cleared
    // when the refetch brings back the value already reflected (or it's reverted if the PATCH
    // fails). Without this, the card would jump back until the refetch.
    const [pendingMoves, setPendingMoves] = useState(() => new Map());
    const [dragOverCol, setDragOverCol] = useState(null);
    const groupByType = getFieldType(schema, groupBy);
    const canDrag = !!onUpdateNote && !NON_DRAGGABLE_GROUP_TYPES.has(groupByType);

    // A record's grouping values. Resolves the key tolerantly (exact
    // or normalized, like `getCardVal`) and returns a LIST: a
    // multi_select/relation field is an ARRAY and the record must appear in EVERY
    // column (like Notion). Previously the exact key and raw value were used, so
    // an array created a spurious "A,B" column and a key with a decorative prefix
    // (emoji) it all fell into 'No Status'.
    const groupValuesOf = (note) => {
        const raw = pendingMoves.has(note.id) ? pendingMoves.get(note.id) : getCardVal(note, groupBy);
        if (Array.isArray(raw)) return raw.map(v => String(v)).filter(Boolean);
        return (raw === undefined || raw === null || String(raw).trim() === '') ? [] : [String(raw)];
    };

    // Clears the pending moves that the `notes` prop already reflects.
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
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only reacts to the arrival of fresh data
    }, [notes]);

    const customStatuses = new Set();
    sortedAndFilteredNotes.forEach(note => {
        groupValuesOf(note).forEach(v => {
            if (!predefinedStatuses.includes(v)) customStatuses.add(v);
        });
    });

    // Bucket for records WITHOUT a value: internal sentinel key (not a
    // literal label like "No Status") so that a real value with this text
    // doesn't collide: it used to generate two columns with the same React key
    // pointing to the SAME bucket (duplicate cards and inflated count).
    const EMPTY_BUCKET = '__gnosi_empty__';
    const allStatuses = [...new Set([...predefinedStatuses, ...Array.from(customStatuses)])].concat(EMPTY_BUCKET);

    // Group notes by status/property
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

    // Apply the group-order settings persisted by PageViewModal. The empty
    // bucket remains last in every mode, matching table and gallery grouping.
    const orderedStatuses = orderGroupKeys({
        keys: allStatuses,
        mode: activeView?.groupSort || activeView?.group_sort || 'catalog',
        direction: activeView?.groupSortDir || activeView?.group_sort_dir || 'asc',
        emptyKey: EMPTY_BUCKET,
        getLabel: status => idToTitle[status] || status,
        getCount: status => groupedNotes[status]?.length || 0,
    });

    // Dropping a card on a column: writes the column's value
    // to the grouping field (like Notion). Multi-value (multi_select/relation):
    // replaces the SOURCE value with the destination one (the rest are kept);
    // empty column: clears the field. PATCH merge on the backend, so only
    // the grouping field is sent.
    const handleDropOnColumn = async (e, targetStatus) => {
        e.preventDefault();
        setDragOverCol(null);
        if (!canDrag) return;
        let payload = null;
        try { payload = JSON.parse(e.dataTransfer.getData('text/plain') || 'null'); } catch { /* foreign */ }
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

        // REAL metadata key (tolerant, like getCardVal): writing the name of
        // the schema when the note saves it with a variant would create a duplicate key.
        const keyNorm = normalizeKey(groupBy);
        const metaKey = Object.keys(note.metadata || {}).find(k => normalizeKey(k) === keyNorm) || groupBy;

        setPendingMoves(prev => new Map(prev).set(id, nextValue));
        try {
            await onUpdateNote(id, { metadata: { [metaKey]: nextValue } });
        } catch (err) {
            console.error('Error moving the column card:', err);
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
                    templates={templates}
                    onApplyTemplate={onApplyTemplate ? (templateId) => { onApplyTemplate(new Set(selectedIds), templateId); clearSelection(); } : null}
                />
            )}

            <div className={`flex-1 overflow-x-auto overflow-y-auto custom-scrollbar ${isEmbedded ? '' : 'px-4 md:px-6 pb-4 md:pb-6 pt-vault-header-top'}`}>
                {!isEmbedded && (
                    <h1 className="text-2xl font-bold mb-6 text-[var(--text-primary)] flex items-center gap-3 sticky left-0">
                        <Columns size={24} className="text-[var(--gnosi-primary)]" />
                        {activeView?.name || t('kanban.default_title', "Kanban board")}
                        <span className="text-sm font-normal text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-full ml-2">
                            {t('kanban.records_count', { count: sortedAndFilteredNotes.length, defaultValue: "{{count}} records" })}
                        </span>
                    </h1>
                )}

                <div className="flex gap-6 min-w-max pb-8 items-start">
                    {orderedStatuses.map(status => (
                        <div
                            key={status}
                            onDragOver={canDrag ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverCol !== status) setDragOverCol(status); } : undefined}
                            onDragLeave={canDrag ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverCol(c => (c === status ? null : c)); } : undefined}
                            onDrop={canDrag ? (e) => handleDropOnColumn(e, status) : undefined}
                            className={`w-80 flex flex-col bg-[var(--bg-tertiary)]/50 rounded-xl p-3 shadow-sm border transition-colors ${dragOverCol === status ? 'border-[var(--gnosi-primary)] ring-2 ring-[var(--gnosi-primary)]/20 bg-[var(--gnosi-primary)]/5' : 'border-[var(--border-primary)]'}`}>
                            <div className="flex justify-between items-center mb-4 px-1">
                                <h3 className="font-bold text-[var(--text-secondary)] text-[10px] tracking-wider uppercase bg-[var(--bg-primary)] px-2.5 py-1 rounded-lg shadow-sm border border-[var(--border-primary)] inline-flex items-center gap-1.5">
                                    {columnColor(status) && <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: columnColor(status) }} />}
                                    {/* Grouping by a RELATION field: the column value is the id of
                                        the related page. `idToTitle` (global index) resolves it to a
                                        title; without this, the header would show the raw UUID. For
                                        select/text, the id isn't present and the value (the option) is kept as-is. */}
                                    {status === EMPTY_BUCKET ? t('kanban.no_status', "No status") : (idToTitle[status] || status)}
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
                                            <span {...titlePreview.getTitleProps(note.id)}>{note.title || t('common.untitled', "Untitled")}</span>
                                        </h4>

                                        {cardColumns.length > 0 && (
                                            <div className="flex flex-col gap-1 mt-2 text-[10px]">
                                                {cardColumns.map(([key, type], pi) => {
                                                    const { value: val, metadataKey } = getCardValue(note, key);
                                                    if (val === undefined || val === null || val === '') return null;
                                                    return (
                                                        <div key={`${key}-${pi}`} className="flex items-center gap-1.5 overflow-hidden min-h-[16px]">
                                                            <span className="font-medium uppercase tracking-wider text-[var(--text-tertiary)] shrink-0 truncate max-w-[45%]">{key}</span>
                                                            <div className="min-w-0 flex-1 text-[var(--text-secondary)]">{renderCardValue(val, type, key, note, metadataKey)}</div>
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
                                        {t('kanban.no_records', "No records")}
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
