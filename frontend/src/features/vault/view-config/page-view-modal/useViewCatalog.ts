import { useEffect, useEffectEvent } from 'react';
import { isProtectedMainView } from '../../views/viewConstants';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewSessionResult } from './useViewSession';
import type { useViewFieldsResult } from './useViewFields';

export function useViewCatalog({
    sourceTableId, setExistingViews, setSelectedExistingViewId, setExistingViewsStatus,
    setExistingViewsTableId, existingViewsRequestRef, readCatalog, sourceTableName,
    existingViewsReloadKey, editingBlock, registryViewsRef
}: Pick<
    useViewStateResult & useViewSessionResult & ModalInput & useViewFieldsResult,
    'sourceTableId'
    | 'setExistingViews'
    | 'setSelectedExistingViewId'
    | 'setExistingViewsStatus'
    | 'setExistingViewsTableId'
    | 'existingViewsRequestRef'
    | 'readCatalog'
    | 'sourceTableName'
    | 'visibleProperties'
    | 'existingViewsReloadKey'
    | 'editingBlock'
    | 'registryViewsRef'
>) {
    const hydrate1 = useEffectEvent(() => {
        if (!sourceTableId) {
            setExistingViews([]);
            setSelectedExistingViewId('');
            setExistingViewsStatus('idle');
            setExistingViewsTableId('');
            return;
        }
        let cancelled = false;
        const requestId = ++existingViewsRequestRef.current;
        setExistingViews(prev => prev.filter(view => view.table_id === sourceTableId));
        setExistingViewsTableId(sourceTableId);
        setExistingViewsStatus('loading');
        readCatalog(sourceTableId)
            .then(registered => {
                if (cancelled || requestId !== existingViewsRequestRef.current) return;
                const list = [...registered];
                for (const view of list) registryViewsRef.current.set(view.id, view);
                const hasMain = list.some(isProtectedMainView);
                if (!hasMain) {
                    list.unshift({
                        id: 'default',
                        table_id: sourceTableId,
                        name: sourceTableName,
                        type: 'table',
                        is_main: true,
                        filters: [],
                        sort: { field: 'last_modified', direction: 'desc' },
                        visibleProperties: [],
                    });
                }
                setExistingViews(prev => {
                    const edited = prev.find(view => view.id === editingBlock?.props?.view_id
                        && view.table_id === sourceTableId);
                    // The displayed embed is the hydration source. A delayed
                    // catalog can contain an older copy of the very same view.
                    return edited ? (list.some(view => view.id === edited.id)
                        ? list.map(view => view.id === edited.id
                            ? { ...view, ...edited, ...(isProtectedMainView(view) ? { is_main: true } : {}) } : view)
                        : [edited, ...list]) : list;
                });
                // If the currently selected view does NOT belong to the new
                // table (user-initiated change), reset. If it DOES belong (pre-filling
                // edit mode), we keep the selection.
                setSelectedExistingViewId(prev => {
                    if (!prev) return '';
                    return list.some(v => v.id === prev) || prev === editingBlock?.props?.view_id ? prev : '';
                });
                setExistingViewsTableId(sourceTableId);
                setExistingViewsStatus('ready');
            })
            .catch(() => {
                if (!cancelled && requestId === existingViewsRequestRef.current) {
                    setExistingViewsTableId(sourceTableId);
                    setExistingViewsStatus('error');
                }
            });
        return () => { cancelled = true; };
    });
    useEffect(() => {
        let active = true;
        let release: (() => void) | undefined;
        queueMicrotask(() => { if (active) release = hydrate1(); });
        return () => { active = false; release?.(); };
    }, [sourceTableId, sourceTableName, existingViewsReloadKey, readCatalog]);

    return {};
}
export type useViewCatalogResult = ReturnType<typeof useViewCatalog>;
