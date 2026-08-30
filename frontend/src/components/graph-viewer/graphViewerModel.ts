import type { FilterValue } from '../../utils/vaultFilters';
export function stringToColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++)
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    let color = '#';
    for (let i = 0; i < 3; i++)
        color += ('00' + ((hash >> (i * 8)) & 0xff).toString(16)).slice(-2);
    return color;
}
export function seededUnitInterval(value: unknown): number {
    let hash = 2166136261;
    const text = String(value);
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
}
function isFilterValue(value: unknown): value is FilterValue {
    if (value === null || value === undefined)
        return true;
    if (['string', 'number', 'boolean', 'bigint'].includes(typeof value))
        return true;
    if (Array.isArray(value))
        return value.every(isFilterValue);
    return typeof value === 'object' && Object.values(value).every(isFilterValue);
}
/** Validate the JSON transport without stringifying IDs or cloning metadata. */
export function transportAttributes(value: Readonly<Record<string, unknown>>): Record<string, FilterValue> {
    const result: Record<string, FilterValue> = {};
    for (const [key, item] of Object.entries(value)) {
        if (!isFilterValue(item))
            throw new TypeError(`Invalid graph transport attribute: ${key}`);
        result[key] = item;
    }
    return result;
}
