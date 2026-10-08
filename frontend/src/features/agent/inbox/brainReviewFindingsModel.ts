export interface Finding { id: string; title: string; }
function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function reviewFindings(value: unknown): Finding[] {
    if (!Array.isArray(value)) return [];
    const found = new Map<string, Finding>();
    for (const row of value) {
        if (!isRecord(row)) continue;
        const item = row;
        if (Array.isArray(item.notes)) {
            for (const note of reviewFindings(item.notes)) found.set(note.id, note);
            continue;
        }
        const id = typeof item.id === 'string' ? item.id : typeof item.resource_id === 'string' ? item.resource_id : '';
        if (id) found.set(id, { id, title: typeof item.title === 'string' ? item.title : '' });
    }
    return [...found.values()];
}

