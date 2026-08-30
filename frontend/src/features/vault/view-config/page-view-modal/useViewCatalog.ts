import { useEffect, useEffectEvent } from 'react';
import { decodeViews } from './decode';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewSessionResult } from './useViewSession';
import type { useViewFieldsResult } from './useViewFields';

export function useViewCatalog({
    sourceTableId, setExistingViews, setSelectedExistingViewId, setExistingViewsStatus,
    setExistingViewsTableId, existingViewsRequestRef, api, sourceTableName,
    existingViewsReloadKey
}: Pick<
    useViewStateResult & useViewSessionResult & ModalInput & useViewFieldsResult,
    'sourceTableId'
    | 'setExistingViews'
    | 'setSelectedExistingViewId'
    | 'setExistingViewsStatus'
    | 'setExistingViewsTableId'
    | 'existingViewsRequestRef'
    | 'api'
    | 'sourceTableName'
    | 'visibleProperties'
    | 'existingViewsReloadKey'
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
        setExistingViews([]);
        setExistingViewsTableId(sourceTableId);
        setExistingViewsStatus('loading');
        api.fetchVaultViews(sourceTableId)
            .then(data => {
                if (cancelled || requestId !== existingViewsRequestRef.current) return;
                const list = decodeViews(data);
                const hasMain = list.some(v =>
                    v.id === 'default'
                    || v.is_main === true
                    || v.is_default === true
                    || ['Main Table', 'Taula Principal'].includes(v.name || '')
                );
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
                setExistingViews(list);
                // If the currently selected view does NOT belong to the new
                // table (user-initiated change), reset. If it DOES belong (pre-filling
                // edit mode), we keep the selection.
                setSelectedExistingViewId(prev => {
                    if (!prev) return '';
                    return list.some(v => v.id === prev) ? prev : '';
                });
                setExistingViewsTableId(sourceTableId);
                setExistingViewsStatus('ready');
            })
            .catch(() => {
                if (!cancelled && requestId === existingViewsRequestRef.current) {
                    setExistingViews([]);
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
    }, [sourceTableId, sourceTableName, existingViewsReloadKey, api]);

    return {};
}
export type useViewCatalogResult = ReturnType<typeof useViewCatalog>;
