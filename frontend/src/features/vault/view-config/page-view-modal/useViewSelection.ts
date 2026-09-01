import { useEffect, useEffectEvent } from 'react';
import { treeFromSource } from './filter-tree';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewSessionResult } from './useViewSession';
import type { useViewAppearanceResult } from './useViewAppearance';

export function useViewSelection({
    selectedExistingViewId, setViewUsage, setEditScope, existingViews,
    setViewName, setVisibleProperties, setJoins, setViewType,
    setFilterTree, setResultSnapshot, setResultSnapshotLimit, applyTypeOptions,
    setSorts, skipNextAutosaveRef, setFormBaselineRevision, setSaveToTableViews,
    api
}: Pick<
    useViewStateResult & useViewAppearanceResult & useViewSessionResult & ModalInput,
    'selectedExistingViewId'
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
    | 'skipNextAutosaveRef'
    | 'setFormBaselineRevision'
    | 'setSaveToTableViews'
    | 'api'
>) {
    const hydrate1 = useEffectEvent(() => {
        if (!selectedExistingViewId) {
            setViewUsage({ count: 0, pages: [] });
            setEditScope('shared');
            return;
        }
        const v = existingViews.find(x => x.id === selectedExistingViewId);
        if (!v) return;
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
        // The virtual "Main Table" has no entry in the registry; we show it
        // as a "starting point" but we enable saving (it will be created as a
        // genuinely new view). The usage also doesn't make sense for 'default'.
        // Pre-selecting an existing view overwrites editing state; skip the
        // next autosave so it isn't mistaken for a user change.
        skipNextAutosaveRef.current = true;
        setFormBaselineRevision(revision => revision + 1);
        if (selectedExistingViewId === 'default' || v.is_main) {
            setSaveToTableViews(true);
            setViewUsage({ count: 0, pages: [] });
            setEditScope('shared');
            return;
        }

        // When you pick a real existing view, we don't duplicate it in the registry.
        setSaveToTableViews(false);
        setEditScope('shared');

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
    }, [selectedExistingViewId, existingViews, api]);
    return {};
}
export type useViewSelectionResult = ReturnType<typeof useViewSelection>;
