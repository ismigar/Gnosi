import { Plus, Trash2 } from 'lucide-react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewFieldsResult } from './useViewFields';
import type { useViewFieldLabelsResult } from './useViewFieldLabels';
import type { useViewActionsResult } from './useViewActions';
import { SortableRow } from './SortableRow';

export function ViewSort({
    activeTab, t, addSort, selectedTable,
    sorts, dndSensors, handleSortDragEnd, updateSort,
    sortedTableFields, fieldLabel, removeSort
}: Pick<
    useViewStateResult & ModalInput & useViewActionsResult & useViewFieldsResult & useViewFieldLabelsResult,
    'activeTab'
    | 't'
    | 'addSort'
    | 'selectedTable'
    | 'sorts'
    | 'dndSensors'
    | 'handleSortDragEnd'
    | 'updateSort'
    | 'sortedTableFields'
    | 'fieldLabel'
    | 'removeSort'
>) {
    return (<>                    {activeTab === 'sort' && (
        <div>
            <div className="flex justify-between items-center mb-3">
                <p className="text-xs text-[var(--text-secondary)]">
                    {t('view.sort_intro', "Priority sorting: the first criterion rules, the rest break ties. With no criteria, rows sort by title ascending.")}
                </p>
                <button
                    onClick={addSort}
                    disabled={!selectedTable}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/20 disabled:opacity-40"
                >
                    <Plus size={12} />
                    {t('view.add_sort', "Add criterion")}
                </button>
            </div>
            {!selectedTable ? (
                <p className="text-sm text-[var(--text-tertiary)] italic">{t('view.pick_table_first', "Select a table first.")}</p>
            ) : sorts.length === 0 ? (
                <p className="text-sm text-[var(--text-tertiary)] italic">{t('view.no_sorts', "No criteria. Default: title ascending.")}</p>
            ) : (
                <div className="space-y-2">
                    <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleSortDragEnd}>
                        <SortableContext items={sorts.map((_, idx) => `sort-${String(idx)}`)} strategy={verticalListSortingStrategy}>
                            {sorts.map((s, idx) => (
                                <SortableRow
                                    key={idx}
                                    id={`sort-${String(idx)}`}
                                    className="flex gap-2 items-center rounded"
                                >
                                    <span className="text-[10px] font-bold text-[var(--text-tertiary)] w-4 text-center">
                                        {idx + 1}
                                    </span>
                                    <select
                                        className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] flex-1"
                                        value={s.field}
                                        onChange={e => { updateSort(idx, { field: e.target.value }); }}
                                    >
                                        {sortedTableFields.map(tf => (
                                            <option key={tf.name} value={tf.name}>{tf.displayName || fieldLabel(tf.name)}</option>
                                        ))}
                                    </select>
                                    <select
                                        className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] w-32"
                                        value={s.direction}
                                        onChange={e => { updateSort(idx, { direction: e.target.value }); }}
                                    >
                                        <option value="asc">{t('view.asc', "Ascending")}</option>
                                        <option value="desc">{t('view.desc', "Descending")}</option>
                                    </select>
                                    <button
                                        onClick={() => { removeSort(idx); }}
                                        className="text-[var(--text-tertiary)] hover:text-red-500 p-1"
                                        title={t('view.delete', "Delete")}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </SortableRow>
                            ))}
                        </SortableContext>
                    </DndContext>
                </div>
            )}
        </div>
    )}</>);
}
