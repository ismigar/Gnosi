interface StructuredAuthor {
    readonly [key: string]: unknown;
    cognom1?: unknown;
    cognom2?: unknown;
    nom?: unknown;
}

function scalarText(value: unknown): string {
    return Reflect.apply(String, undefined, [value]);
}

export function isStructuredAuthor(value: unknown): value is StructuredAuthor {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && ('nom' in value || 'cognom1' in value || 'cognom2' in value);
}

/** Read searchable values without mutating metadata or following ancestor cycles. */
export function textValues(value: unknown, ancestors = new Set<object>()): string[] {
    if (value === null || value === undefined || value === '') return [];
    if (isStructuredAuthor(value)) {
        return [[value.nom, value.cognom1, value.cognom2]
            .map(part => scalarText(part ?? '')).filter(Boolean).join(' ')];
    }
    if (typeof value !== 'object') return [scalarText(value)];
    if (ancestors.has(value)) return [];
    ancestors.add(value);
    try {
        const children: readonly unknown[] = Array.isArray(value) ? value : Object.values(value);
        return children.flatMap(child => textValues(child, ancestors));
    } finally {
        ancestors.delete(value);
    }
}
