import { inputValue } from './input-value';
import { arrayMove } from '@dnd-kit/sortable';
import { logError } from '../../../../shared/notifications/notifyError';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewFieldsResult } from './useViewFields';
import type { ViewSort, VisibleProperty, FilterValue, RegistryView } from './types';
import type { DragEndEvent } from '@dnd-kit/core';

export function useViewActions({
    setModalViewToDelete, setModalViewToDeleteUsage, api, modalViewToDelete,
    setExistingViews, setModalPinnedViewIds, selectedExistingViewId, setSelectedExistingViewId,
    sourceTableId, setVisibleProperties, isMultiTable, fieldMeta,
    tableFields, setSorts
}: Pick<
    useViewStateResult & ModalInput & useViewFieldsResult,
    'setModalViewToDelete'
    | 'setModalViewToDeleteUsage'
    | 'api'
    | 'modalViewToDelete'
    | 'setExistingViews'
    | 'setModalPinnedViewIds'
    | 'selectedExistingViewId'
    | 'setSelectedExistingViewId'
    | 'sourceTableId'
    | 'setVisibleProperties'
    | 'isMultiTable'
    | 'fieldMeta'
    | 'tableFields'
    | 'setSorts'
>) {
    const requestDeleteViewFromModal = (v: RegistryView) => {
        if (!v.id || v.is_main || v.id === 'default') return;
        setModalViewToDelete(v);
        setModalViewToDeleteUsage(null);
        api.fetchVaultViewUsage(v.id)
            .then(data => { setModalViewToDeleteUsage(data); })
            .catch(() => { });
    };
    const confirmDeleteViewFromModal = async () => {
        if (!modalViewToDelete?.id) return;
        const vid = modalViewToDelete.id;
        try {
            await api.deleteVaultView(vid);
            setExistingViews(prev => prev.filter(x => x.id !== vid));
            setModalPinnedViewIds(prev => {
                const next = new Set(prev);
                next.delete(vid);
                return next;
            });
            if (selectedExistingViewId === vid) {
                setSelectedExistingViewId('');
            }
        } catch (e) {
            logError('PageViewModal.deleteView', e);
        } finally {
            setModalViewToDelete(null);
            setModalViewToDeleteUsage(null);
        }
    };
    const colKey = (entry: VisibleProperty) => {
        if (entry && typeof entry === 'object' && entry.fieldKey) {
            return `${entry.tableId || sourceTableId}::${entry.fieldKey}`;
        }
        return `${sourceTableId}::${inputValue(entry)}`;
    };

    const toggleProperty = (tid: string, name: string) => {
        // The base table's `title` is the primary column (as in Notion): always
        // visible, cannot be deselected.
        if ((!tid || tid === sourceTableId) && name === 'title') return;
        const key = `${tid || sourceTableId}::${name}`;
        setVisibleProperties(prev => {
            const keys = new Set(prev.map(colKey));
            if (keys.has(key)) {
                return prev.filter(e => colKey(e) !== key);
            }
            // Add in the form that matches the current view (composite if
            // multi-table, string if single-table and it's the base).
            if (isMultiTable) {
                return [...prev, { tableId: tid || sourceTableId, fieldKey: name }];
            }
            return [...prev, name];
        });
    };

    // Reorders a visible column by dragging it (ids = canonical keys).
    const handleColumnDragEnd = ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return;
        setVisibleProperties(prev => {
            const oldIndex = prev.findIndex(e => colKey(e) === active.id);
            const newIndex = prev.findIndex(e => colKey(e) === over.id);
            if (oldIndex === -1 || newIndex === -1) return prev;
            return arrayMove(prev, oldIndex, newIndex);
        });
    };

    // Initial value of a filter based on the field type: checkboxes start
    // with a specific boolean ('false' = unchecked) instead of empty, because the
    // engine's boolean comparison also matches rows with no value.
    const defaultFilterValue = (fieldName: string): FilterValue => {
        const type = fieldMeta[fieldName]?.type;
        if (type === 'checkbox') return 'false';
        if (type === 'multi_select') return [];
        if (type === 'autoria') return { nom: '', cognom1: '', cognom2: '' };
        return '';
    };

    const addSort = () => {
        const firstField = tableFields[0]?.name || 'title';
        setSorts(prev => [...prev, { field: firstField, direction: 'asc' }]);
    };

    const updateSort = (idx: number, patch: Partial<ViewSort>) => {
        setSorts(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
    };

    const removeSort = (idx: number) => {
        setSorts(prev => prev.filter((_, i) => i !== idx));
    };

    // Reorders a sort criterion by dragging it. Rows are identified by
    // positional ids ("sort-<idx>"): stable during the drag (the array only
    // mutates on drop) and immune to duplicate field names.
    const handleSortDragEnd = ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return;
        const oldIndex = Number(String(active.id).slice('sort-'.length));
        const newIndex = Number(String(over.id).slice('sort-'.length));
        if (Number.isNaN(oldIndex) || Number.isNaN(newIndex)) return;
        setSorts(prev => arrayMove(prev, oldIndex, newIndex));
    };
    return {
        requestDeleteViewFromModal, confirmDeleteViewFromModal, colKey, toggleProperty,
        handleColumnDragEnd, defaultFilterValue, addSort, updateSort,
        removeSort, handleSortDragEnd
    };
}
export type useViewActionsResult = ReturnType<typeof useViewActions>;
