export type LoosePrimitive = string | number | boolean | null | undefined;
export type LooseValue = LoosePrimitive | LooseRecord | LooseValue[];

export interface LooseRecord {
    [key: string]: LooseValue;
}

export type DurationUnit = 'm' | 'ms' | 's';

export interface CandidateEntry {
    unitHint?: DurationUnit | null;
    value: LooseValue;
}

export function isRecord(value: unknown): value is LooseRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isLooseArray(value: unknown): value is LooseValue[] {
    return Array.isArray(value);
}

export function asLooseArray(value: unknown): LooseValue[] {
    return isLooseArray(value) ? value : [];
}

export function recordValue(value: unknown, key: string): LooseValue {
    return isRecord(value) ? value[key] : undefined;
}

export function stringifyLooseValue(value: LooseValue): string {
    return Reflect.apply(String, undefined, [value]);
}
