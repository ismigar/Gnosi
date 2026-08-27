/**
 * Orders view groups while keeping the empty-value bucket at the end.
 *
 * Catalog order is the incoming key order. Alphabetical order uses the
 * user-visible label, and count order uses each bucket's record count.
 */
export function orderGroupKeys({
    keys = [],
    mode = 'catalog',
    direction = 'asc',
    emptyKey,
    getLabel = (key) => key,
    getCount = () => 0,
} = {}) {
    const factor = direction === 'desc' ? -1 : 1;
    const catalogIndex = new Map(keys.map((key, index) => [key, index]));
    const emptyKeys = keys.filter(key => key === emptyKey);
    const ordered = keys.filter(key => key !== emptyKey);

    if (mode === 'alpha') {
        ordered.sort((a, b) => (
            String(getLabel(a) ?? '').localeCompare(
                String(getLabel(b) ?? ''),
                undefined,
                { numeric: true },
            ) || catalogIndex.get(a) - catalogIndex.get(b)
        ) * factor);
    } else if (mode === 'count') {
        ordered.sort((a, b) => (
            getCount(a) - getCount(b)
            || catalogIndex.get(a) - catalogIndex.get(b)
        ) * factor);
    } else if (factor === -1) {
        ordered.reverse();
    }

    return [...ordered, ...emptyKeys];
}
