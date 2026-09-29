/** Group persisted values without dropping false, zero, arrays or structured fields. */
export function groupValueKeys(value: unknown, seen = new Set<object>()): string[] {
    if (value == null || value === '') return [];
    if (typeof value !== 'object') {
        return (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
            && String(value).trim() ? [String(value)] : [];
    }
    if (seen.has(value)) return [];
    const nested = new Set(seen).add(value);
    if (Array.isArray(value)) {
        const items: readonly unknown[] = value;
        return [...new Set(items.flatMap(item => groupValueKeys(item, nested)))];
    }
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? [] : [value.toISOString()];
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) return [];
    // Canonical keys keep objects with equal values together regardless of property order.
    return [JSON.stringify(Object.fromEntries(entries.map(([key, item]: [string, unknown]) => (
        [key, groupValueKeys(item, nested)]
    ))))];
}

export function groupValueLabel(key: string): string {
    if (!key.startsWith('{')) return key;
    try {
        const value: unknown = JSON.parse(key);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return key;
        const values = Object.entries(value);
        const preferred = values.find(([name]) => ['name', 'title', 'filename', 'plain_text', 'text', 'url'].includes(name));
        const labels = (raw: unknown): string => Array.isArray(raw)
            ? (raw as unknown[]).filter((part): part is string => typeof part === 'string').map(groupValueLabel).join(', ')
            : '';
        return preferred ? labels(preferred[1]) : values.map(([name, raw]) => `${name}: ${labels(raw)}`).join(' · ');
    } catch { return key; }
}

export function readGroupValue(
    note: { readonly title?: unknown; readonly metadata?: Readonly<Record<string, unknown>> | null },
    field: string,
    fieldId?: string | null,
): unknown {
    if (field === 'title') return note.title;
    const metadata = note.metadata ?? {};
    if (Object.hasOwn(metadata, field)) return metadata[field];
    if (fieldId && Object.hasOwn(metadata, fieldId)) return metadata[fieldId];
    const normalize = (key: string) => key.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/[^a-z0-9]/gu, '');
    const alias = Object.keys(metadata).find(key => normalize(key) === normalize(field));
    return alias ? metadata[alias] : Reflect.get(note, field) as unknown;
}
