import { useEffect } from 'react';
import { collectLeafRules } from './filter-tree';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewFieldsResult } from './useViewFields';

export function useViewRelations({
    isOpen, filterTree, fieldMeta, relationCache,
    api, t, setRelationCache
}: Pick<
    ModalInput & useViewStateResult & useViewFieldsResult,
    'isOpen'
    | 'filterTree'
    | 'fieldMeta'
    | 'relationCache'
    | 'api'
    | 't'
    | 'setRelationCache'
>) {
    useEffect(() => {
        if (!isOpen) return;
        const targets = new Set<string>();
        collectLeafRules(filterTree).forEach(f => {
            const meta = fieldMeta[f.field];
            if (meta?.type === 'relation' && meta.relation_database_id) targets.add(meta.relation_database_id);
        });
        const load = async (tid: string) => {
            if (relationCache[tid] !== undefined) return;
            try {
                const rows = await api.fetchVaultPagesByTable(tid);
                const opts = (Array.isArray(rows) ? rows : [])
                    .filter(r => !r.metadata.is_template)
                    .map(r => ({ value: r.id, label: r.title || t('view.untitled', "(untitled)") }))
                    .sort((a, b) => a.label.localeCompare(b.label));
                setRelationCache(prev => ({ ...prev, [tid]: opts }));
            } catch {
                setRelationCache(prev => ({ ...prev, [tid]: [] }));
            }
        };
        targets.forEach(tid => { void load(tid); });
    }, [isOpen, filterTree, fieldMeta, api, relationCache, t, setRelationCache]);

    return {};
}
export type useViewRelationsResult = ReturnType<typeof useViewRelations>;
