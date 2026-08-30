import { useEffect, useEffectEvent } from 'react';
import { discoverFieldNamesFromRecords } from '../schemaUtils';
import { decodePages } from './decode';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewFieldsResult } from './useViewFields';

export function useViewDiscovery({
    api, selectedTable, sourceTableId, setDiscoveredFields,
    joins, discoveredByTable, allTables, setDiscoveredByTable
}: Pick<
    ModalInput & useViewFieldsResult & useViewStateResult,
    'api'
    | 'selectedTable'
    | 'sourceTableId'
    | 'setDiscoveredFields'
    | 'joins'
    | 'discoveredByTable'
    | 'allTables'
    | 't'
    | 'setDiscoveredByTable'
>) {
    const hydrate1 = useEffectEvent(() => {
        const discoverFor = (tid: string, hasSchema: boolean, setter: (fields: string[]) => void) => {
            if (!tid) { setter([]); return; }
            if (hasSchema) { setter([]); return; }
            let cancelled = false;
            api.fetchVaultPages({ table_id: tid, limit: 300 })
                .then(data => {
                    if (cancelled) return;
                    const recs = decodePages(data);
                    setter(discoverFieldNamesFromRecords(recs));
                })
                .catch(() => { if (!cancelled) setter([]); });
            return () => { cancelled = true; };
        };
        const baseHasSchema = Array.isArray(selectedTable?.properties) && selectedTable.properties.length > 0;
        const baseCleanup = discoverFor(sourceTableId, baseHasSchema, setDiscoveredFields);
        // Joins: discover for each table that has no schema. Tables WITH schema
        // get an empty entry so the picker knows there is nothing to discover.
        const joinTableIds = joins.map(j => j.tableId).filter(Boolean);
        const cleanups: (() => void)[] = [];
        const next = { ...discoveredByTable };
        let changed = false;
        for (const tid of joinTableIds) {
            const tbl = allTables.find(t => t.id === tid);
            const hasSchema = Array.isArray(tbl?.properties) && tbl.properties.length > 0;
            if (hasSchema) {
                if (next[tid] && next[tid].length) { next[tid] = []; changed = true; }
                continue;
            }
            if (next[tid] === undefined) {
                next[tid] = []; changed = true;
                const c = discoverFor(tid, false, (fields) => {
                    setDiscoveredByTable(prev => ({ ...prev, [tid]: fields }));
                });
                if (c) cleanups.push(c);
            }
        }
        // Drop entries for tables no longer in the joins.
        for (const tid of Object.keys(next)) {
            if (!joinTableIds.includes(tid)) { Reflect.deleteProperty(next, tid); changed = true; }
        }
        if (changed) setDiscoveredByTable(next);
        return () => { baseCleanup?.(); cleanups.forEach(c => { c(); }); };
    });
    useEffect(() => {
        let active = true;
        let release: (() => void) | undefined;
        queueMicrotask(() => { if (active) release = hydrate1(); });
        return () => { active = false; release?.(); };
    }, [sourceTableId, selectedTable, joins, allTables, api]);
    return {};
}
export type useViewDiscoveryResult = ReturnType<typeof useViewDiscovery>;
