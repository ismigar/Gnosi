import { Trash2 } from 'lucide-react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewFieldsResult } from './useViewFields';
import type { useViewFieldLabelsResult } from './useViewFieldLabels';
import type { useViewActionsResult } from './useViewActions';
import { SortableRow } from './SortableRow';
import type { Field } from './types';

export function ViewColumns({
    activeTab, t, selectedTable, normalizeColumns,
    visibleProperties, colKey, sourceTableId, fieldsForTable,
    dndSensors, handleColumnDragEnd, allTables, fieldLabel,
    toggleProperty, viewTables, isMultiTable
}: Pick<
    useViewStateResult & ModalInput & useViewFieldsResult & useViewActionsResult & useViewFieldLabelsResult,
    'activeTab'
    | 't'
    | 'selectedTable'
    | 'normalizeColumns'
    | 'visibleProperties'
    | 'colKey'
    | 'sourceTableId'
    | 'fieldsForTable'
    | 'dndSensors'
    | 'handleColumnDragEnd'
    | 'allTables'
    | 'fieldLabel'
    | 'toggleProperty'
    | 'viewTables'
    | 'isMultiTable'
>) {
    return (<>                    {activeTab === 'properties' && (
        <div>
            <p className="text-xs text-[var(--text-secondary)] mb-3">
                {t('view.fields_intro', "Select the fields to show as columns.")}
            </p>
            {!selectedTable ? (
                <p className="text-sm text-[var(--text-tertiary)] italic">
                    {t('view.pick_table_general', "Select a table first in the General tab.")}
                </p>
            ) : (
                <div className="space-y-3 max-h-[44vh] overflow-y-auto">
                    {(() => {
                        // Normalize visible entries to composite form so the
                        // picker works uniformly across single/multi-table.
                        const norm = normalizeColumns(visibleProperties);
                        const selectedKeys = new Set(norm.map(colKey));
                        const isSelected = (tid: string, name: string) =>
                            selectedKeys.has(`${tid || sourceTableId}::${name}`);
                        // Build the meta lookup per involved table.
                        const metaFor = (tid: string) => {
                            const fields = fieldsForTable(tid);
                            const m: Record<string, Field | undefined> = {};
                            fields.forEach(f => { m[f.name] = f; });
                            return m;
                        };
                        return (
                            <>
                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1 px-2">
                                        {t('view.visible_columns', "Visible columns (order)")}
                                    </p>
                                    {norm.length === 0 ? (
                                        <p className="text-xs text-[var(--text-tertiary)] italic px-2 py-1">{t('view.no_columns', "No columns. Pick one below.")}</p>
                                    ) : (
                                        <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleColumnDragEnd}>
                                            <SortableContext items={norm.map(colKey)} strategy={verticalListSortingStrategy}>
                                                {norm.map(c => {
                                                    const tid = c.tableId || sourceTableId;
                                                    const m = metaFor(tid);
                                                    const f = m[c.fieldKey] || { name: c.fieldKey, type: '' };
                                                    const isJoin = tid !== sourceTableId;
                                                    const tableName = allTables.find(t => t.id === tid)?.name;
                                                    return (
                                                        <SortableRow
                                                            key={colKey(c)}
                                                            id={colKey(c)}
                                                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-tertiary)]"
                                                        >
                                                            <span className="text-sm text-[var(--text-primary)] flex-1">
                                                                {isJoin && tableName ? (
                                                                    <span className="text-[10px] text-[var(--text-tertiary)] mr-1">{tableName} ·</span>
                                                                ) : null}
                                                                {f.displayName || fieldLabel(f.name)}
                                                            </span>
                                                            <span className="text-[10px] text-[var(--text-tertiary)] uppercase">{f.type || ''}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => { toggleProperty(tid, f.name); }}
                                                                disabled={!isJoin && f.name === 'title'}
                                                                className="text-[var(--text-tertiary)] hover:text-red-500 p-1 disabled:opacity-25 disabled:hover:text-[var(--text-tertiary)] disabled:cursor-not-allowed"
                                                                title={!isJoin && f.name === 'title' ? t('view.title_always_visible', "The title is always visible") : t('view.remove', "Remove")}
                                                            >
                                                                <Trash2 size={13} />
                                                            </button>
                                                        </SortableRow>
                                                    );
                                                })}
                                            </SortableContext>
                                        </DndContext>
                                    )}
                                </div>
                                {/* Available fields, grouped by table. In single-table views
                                                    this renders a single group identical to the previous UI. */}
                                {viewTables.map(tbl => {
                                    const fields = fieldsForTable(tbl.id);
                                    const available = fields.filter(f => !isSelected(tbl.id, f.name));
                                    if (available.length === 0) return null;
                                    return (
                                        <div key={tbl.id}>
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1 px-2">
                                                {isMultiTable
                                                    ? t('view.fields_for_table', { table: tbl.name, defaultValue: "{{table}}" })
                                                    : t('view.available', "Available")}
                                            </p>
                                            {available.map(f => (
                                                <label
                                                    key={`${tbl.id}-${f.name}`}
                                                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-tertiary)] cursor-pointer"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={false}
                                                        onChange={() => { toggleProperty(tbl.id, f.name); }}
                                                        className="rounded border-[var(--border-primary)]"
                                                    />
                                                    <span className="text-sm text-[var(--text-primary)] flex-1">{f.displayName || fieldLabel(f.name)}</span>
                                                    <span className="text-[10px] text-[var(--text-tertiary)] uppercase">{f.type || ''}</span>
                                                </label>
                                            ))}
                                        </div>
                                    );
                                })}
                            </>
                        );
                    })()}
                </div>
            )}
        </div>
    )}</>);
}
