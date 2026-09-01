import type { LucideIcon } from 'lucide-react';
import {
    Blocks,
    Database,
    FileText,
    Globe,
    Landmark,
    Layers,
    Paperclip,
} from 'lucide-react';


export type ContextSourceKind =
    | 'database'
    | 'file'
    | 'internal'
    | 'page'
    | 'source'
    | 'table'
    | 'url'
    | 'vault';


export type ContextPickingKind = Extract<
    ContextSourceKind,
    'internal' | 'page' | 'source' | 'table'
>;


export type ContextScope = Readonly<Record<string, unknown>>;


export interface ContextReference {
    readonly id: string;
    readonly label: string;
    readonly ref: string;
    readonly scope?: ContextScope;
    readonly type: ContextSourceKind;
}


export interface ContextCatalogItem {
    readonly id: string;
    readonly label: string;
    readonly scope?: ContextScope;
}


export interface NamedContextOption {
    readonly id: number | string;
    readonly name: string;
}


export const CONTEXT_KIND_ICONS: Readonly<
    Record<ContextSourceKind, LucideIcon>
> = {
    database: Database,
    file: Paperclip,
    internal: Blocks,
    page: FileText,
    source: Landmark,
    table: Database,
    url: Globe,
    vault: Layers,
};


const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);


export const stringValue = (value: unknown): string => (
    typeof value === 'string' ? value : ''
);


export const contextString = (
    record: ContextScope | undefined,
    key: string,
    fallback = '',
): string => stringValue(record?.[key]) || fallback;


export const contextBoolean = (
    record: ContextScope | undefined,
    key: string,
    fallback: boolean,
): boolean => typeof record?.[key] === 'boolean'
    ? record[key]
    : fallback;


export const contextStringArray = (
    record: ContextScope | undefined,
    key: string,
): string[] => Array.isArray(record?.[key])
    ? record[key].filter((item): item is string => typeof item === 'string')
    : [];


export const contextNumberArray = (
    record: ContextScope | undefined,
    key: string,
): number[] => Array.isArray(record?.[key])
    ? record[key].filter((item): item is number => typeof item === 'number')
    : [];


export const contextNamedOptions = (
    record: ContextScope | undefined,
    key: string,
): NamedContextOption[] => {
    const value = record?.[key];
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        if (!isRecord(item)) return [];
        const id = item.id;
        const name = stringValue(item.name);
        return (typeof id === 'string' || typeof id === 'number') && name
            ? [{ id, name }]
            : [];
    });
};


export const contextOptionStrings = (
    record: ContextScope | undefined,
    key: string,
): string[] => contextStringArray(record, key);


export const asContextScope = (value: unknown): ContextScope => (
    isRecord(value) ? value : {}
);


export const catalogItem = (value: unknown): ContextCatalogItem | null => {
    if (!isRecord(value)) return null;
    const rawId = value.id;
    const id = typeof rawId === 'number' ? rawId.toString() : stringValue(rawId);
    if (!id) return null;
    const label = stringValue(value.title)
        || stringValue(value.name)
        || stringValue(value.label)
        || id;
    return {
        id,
        label,
        ...(isRecord(value.scope) ? { scope: value.scope } : {}),
    };
};


export const catalogItems = (values: readonly unknown[]): ContextCatalogItem[] => (
    values.flatMap((value) => {
        const item = catalogItem(value);
        return item ? [item] : [];
    })
);


export const newContextRefId = (): string => (
    `ctx-${Math.random().toString(36).slice(2, 10)}`
);
