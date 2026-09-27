import type { PropertyScalar } from './types';

function isScalar(value: unknown): value is PropertyScalar {
    return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function readScalars(value: unknown): PropertyScalar[] {
    const values: readonly unknown[] = Array.isArray(value) ? value : [value];
    if (values.every(isScalar)) return [...values];
    // Object metadata was never renderable as a pill. Fail explicitly instead
    // of silently dropping values that would then be lost on the next save.
    throw new TypeError('Property selections must contain scalar values');
}

export function readPropertyValues(value: unknown): PropertyScalar[] {
    if (!value) return [];
    if (Array.isArray(value)) return readScalars(value);
    let parsed: unknown;
    try {
        parsed = JSON.parse(propertyKey(value));
    } catch {
        return readScalars(value);
    }
    return readScalars(parsed);
}

/** Same JS key coercion as legacy metadata lookup, isolated at its boundary. */
export function propertyKey(value: unknown): string {
    return String(value);
}

export function foldAccents(value: unknown): string {
    return propertyKey(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function optionRecord(value: unknown): Readonly<Record<string, unknown>> | null {
    return typeof value === 'object' && value !== null ? value as Readonly<Record<string, unknown>> : null;
}

export function readPropertyOptions(options: readonly unknown[] | null | undefined) {
    const optionKeys: string[] = [];
    const colors = new Map<string, unknown>();
    for (const option of options ?? []) {
        const record = optionRecord(option);
        const name = propertyKey(record ? record.name ?? '' : option ?? '');
        if (name) optionKeys.push(name);
        if (record?.name) colors.set(name, record.color || null);
    }
    const optionColorByKey: Readonly<Record<string, unknown>> = Object.fromEntries(colors);
    return { optionKeys, optionColorByKey };
}
