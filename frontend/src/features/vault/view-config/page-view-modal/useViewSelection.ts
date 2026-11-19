import { readPinnedViews } from './pinned-views';
import { useEffect, useEffectEvent } from 'react';
import { treeFromSource } from './filter-tree';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import { viewSelectionKey, type useViewSessionResult } from './useViewSession';
import type { useViewAppearanceResult } from './useViewAppearance';
import type { ViewConfig } from './types';

export function useViewSelection({
    selectedExistingViewId, sourceTableId, isTableMode, editingBlock, formBaselineRevision, viewLoadStatus,
    savedSelections, inlineSourceRef, setViewUsage, setEditScope, existingViews,
    setViewName, setVisibleProperties, setJoins, setViewType,
    setFilterTree, setResultSnapshot, setResultSnapshotLimit, applyTypeOptions,
    setSorts, appliedSelectionRef, updatedViewsRef, setSaveToTableViews,
    api, pageId, setModalPinnedViewIds
}: Pick<
    useViewStateResult & useViewAppearanceResult & useViewSessionResult & ModalInput,
    'selectedExistingViewId'
    | 'sourceTableId'
    | 'isTableMode'
    | 'editingBlock'
    | 'formBaselineRevision'
    | 'viewLoadStatus'
    | 'savedSelections'
    | 'inlineSourceRef'
    | 'setViewUsage'
    | 'setEditScope'
    | 'existingViews'
    | 'setViewName'
    | 'setVisibleProperties'
    | 'setJoins'
    | 'setViewType'
    | 'setFilterTree'
    | 'setResultSnapshot'
    | 'setResultSnapshotLimit'
    | 'applyTypeOptions'
    | 'setSorts'
    | 'appliedSelectionRef'
    | 'updatedViewsRef'
    | 'setSaveToTableViews'
    | 'api'
    | 'pageId'
    | 'setModalPinnedViewIds'
>) {
    const hydrate1 = useEffectEvent(() => {
        if (isTableMode || !sourceTableId || !formBaselineRevision || viewLoadStatus !== 'ready') return;
        const key = viewSelectionKey(sourceTableId, selectedExistingViewId);
        if (!selectedExistingViewId && appliedSelectionRef.current === null) {
            // The initial local draft was already populated when the dialog opened.
            appliedSelectionRef.current = key;
            return;
        }
        const saved = savedSelections.get(key);
        const local = inlineSourceRef.current;
        const localDefaults: ViewConfig = local && (local.table_id || local.source_table_id) === sourceTableId ? local : {};
        const v = saved?.view || updatedViewsRef.current.get(selectedExistingViewId)
            || (selectedExistingViewId ? existingViews.find(x => x.id === selectedExistingViewId) : localDefaults);
        if (!v) return;
        if (appliedSelectionRef.current !== key) {
            appliedSelectionRef.current = key;
            setModalPinnedViewIds(saved?.pins || readPinnedViews(pageId, selectedExistingViewId, Array.isArray(v.tabs) ? v.tabs.map(String) : []));
            setViewName(v.name || '');
            setVisibleProperties(Array.isArray(v.visibleProperties) && v.visibleProperties.length ? v.visibleProperties : ['title']);
            setJoins(Array.isArray(v.joins) ? v.joins : []);
            setViewType(v.type || 'table');
            setFilterTree(treeFromSource(v));
            setResultSnapshot(v.resultSnapshot !== false);
            setResultSnapshotLimit(Number.isFinite(Number(v.resultSnapshotLimit)) ? Number(v.resultSnapshotLimit) : 500);
            applyTypeOptions(v);
            // Compat: the registry can have `sorts: [...]` (new) or `sort: {...}` (legacy)
            if (Array.isArray(v.sorts) && v.sorts.length > 0) {
                setSorts(v.sorts);
            } else if (v.sort && v.sort.field) {
                setSorts([{ field: v.sort.field, direction: v.sort.direction || 'asc' }]);
            } else {
                setSorts([]);
            }
            setSaveToTableViews(saved?.saveToTableViews ?? (selectedExistingViewId ? selectedExistingViewId === 'default' || v.is_main === true : !editingBlock));
            setEditScope(saved?.editScope || 'shared');
            setViewUsage({ count: 0, pages: [] });
        }
        // The virtual "Main Table" has no entry in the registry; we show it
        // as a "starting point" but we enable saving (it will be created as a
        // genuinely new view). The usage also doesn't make sense for 'default'.
        if (!selectedExistingViewId || selectedExistingViewId === 'default' || v.is_main) {
            return;
        }

        // Loads usage to find out whether the view is shared.
        let cancelled = false;
        api.fetchVaultViewUsage(selectedExistingViewId)
            .then(data => {
                if (cancelled) return;
                setViewUsage({
                    count: data.count || 0,
                    pages: data.pages,
                });
            })
            .catch(() => {
                if (!cancelled) setViewUsage({ count: 0, pages: [] });
            });
        return () => { cancelled = true; };
    });
    useEffect(() => {
        let active = true;
        let release: (() => void) | undefined;
        queueMicrotask(() => { if (active) release = hydrate1(); });
        return () => { active = false; release?.(); };
    }, [formBaselineRevision, viewLoadStatus, sourceTableId, selectedExistingViewId, existingViews, api]);
    return {};
}
export type useViewSelectionResult = ReturnType<typeof useViewSelection>;
