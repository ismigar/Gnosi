import { useMemo, useState } from 'react';
import { applyExposedFilters, exposedFilterEntries, sourceFilterTree, type FilterOverrides, type FilterOverride, type FilterSource } from './exposedFilters';

const EMPTY_OVERRIDES: FilterOverrides = {};

export function useExposedFilters(source: FilterSource, scope: string) {
    const { filterTree: savedTree, filters, filter } = source;
    const tree = useMemo(() => sourceFilterTree({ filterTree: savedTree, filters, filter }), [savedTree, filters, filter]);
    // Overrides belong to one configuration and page/tab scope. Separate
    // mounted instances always own separate, temporary filter values.
    const signature = `${scope}:${JSON.stringify(tree)}`;
    const [state, setState] = useState<{ signature: string; values: FilterOverrides }>({ signature, values: {} });
    const values = state.signature === signature ? state.values : EMPTY_OVERRIDES;
    const entries = useMemo(() => exposedFilterEntries(tree, values), [tree, values]);
    const filterTree = useMemo(() => applyExposedFilters(tree, values), [tree, values]);
    return {
        entries,
        filterTree,
        changed: Object.keys(values).length > 0,
        update: (key: string, value: FilterOverride) => {
            setState(previous => ({ signature, values: { ...(previous.signature === signature ? previous.values : {}), [key]: value } }));
        },
        reset: () => { setState({ signature, values: {} }); },
    };
}
export type ExposedFilterControls = ReturnType<typeof useExposedFilters>;
