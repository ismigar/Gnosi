import type { ActionConfig, Assignment, AssignmentValue, Catalogs, EditorFormat } from './types';
import { normalizeOptions } from '../optionCatalogUtils';

export function readRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function readString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

export function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function readNumberOrString(value: unknown): string | number {
    return typeof value === 'number' || typeof value === 'string' ? value : '';
}

export function readCounts(value: unknown): Record<string, number> {
    return Object.fromEntries(Object.entries(readRecord(value)).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
}

export function readCatalogs(value: unknown): Catalogs {
    return Object.fromEntries(Object.entries(readRecord(value)).map(([name, options]) => [name, normalizeOptions(options)]));
}

export function readFormat(value: unknown): EditorFormat {
    const record = readRecord(value);
    return {
        ...record,
        kind: readString(record.kind),
        currency: readString(record.currency),
        dateFormat: readString(record.dateFormat),
        decimals: record.decimals == null ? record.decimals : readNumberOrString(record.decimals),
    };
}

function isAssignmentValue(value: unknown): value is AssignmentValue {
    return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        || (Array.isArray(value) && value.every((item: unknown) => typeof item === 'string'));
}

export function readActionConfig(value: unknown): ActionConfig {
    const record = readRecord(value);
    // Keep extension-owned keys intact. Only narrow controls that the editor reads.
    const config: ActionConfig = { ...record };
    for (const key of ['prompt', 'target_field', 'skill_id'] as const) {
        if (key in record) config[key] = readString(record[key]);
    }
    if (Array.isArray(record.assignments)) {
        config.assignments = record.assignments.map((entry: unknown): Assignment => {
            const assignment = readRecord(entry);
            const next: Assignment = { ...assignment };
            if ('field' in assignment) next.field = readString(assignment.field);
            if ('value' in assignment) next.value = isAssignmentValue(assignment.value) ? assignment.value : '';
            if ('custom' in assignment) next.custom = assignment.custom === true;
            return next;
        });
    }
    return config;
}

export function apiErrorDetail(error: unknown, fallback: string): string {
    const record = readRecord(error);
    return readString(readRecord(record.payload).detail)
        || readString(readRecord(readRecord(record.response).data).detail)
        || fallback;
}
