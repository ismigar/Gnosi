import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

import type { BuiltinPluginDefinition } from '../../plugins/registry';
import type { VaultRegistryRecord } from '../../shared/api/vaults';
import {
    defineStorageKey,
    removeStorage,
    stringStorageCodec,
    readStorage,
} from '../../shared/platform/browser-storage';

export type PluginSection = 'installed' | 'catalog' | 'updates';
export type InstalledFilter = 'all' | 'enabled' | 'disabled';
export type PluginConfigComponent = ComponentType;

export function isPluginSection(value: string): value is PluginSection {
    return value === 'installed' || value === 'catalog' || value === 'updates';
}

export interface VaultProperty {
    readonly id: string;
    readonly name: string;
    readonly relation_database_id?: string;
    readonly type: string;
}

export interface VaultTable {
    readonly id: string;
    readonly name: string;
    readonly properties: readonly VaultProperty[];
}

export interface LifecycleConflict {
    readonly code: 'plugin_dependency_confirmation_required';
    readonly disable: readonly string[];
    readonly enable: readonly string[];
}

export interface PendingLifecycle extends LifecycleConflict {
    readonly enabled: boolean;
    readonly pluginId: string;
}

export interface DisplayPlugin extends BuiltinPluginDefinition {
    readonly Icon: LucideIcon;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

const CONFIGURE_PLUGIN_KEY = defineStorageKey(
    'gnosi:configure-plugin',
    stringStorageCodec,
    'session',
);

export function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function stringList(value: unknown): readonly string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
}

function normalizeProperty(value: unknown): VaultProperty | null {
    if (!isRecord(value) || typeof value.id !== 'string') return null;
    return {
        id: value.id,
        name: optionalString(value.name) ?? value.id,
        relation_database_id: optionalString(value.relation_database_id),
        type: optionalString(value.type) ?? '',
    };
}

export function normalizeVaultTables(
    records: readonly VaultRegistryRecord[],
): VaultTable[] {
    return records.flatMap((record) => {
        if (!isRecord(record) || typeof record.id !== 'string') return [];
        const rawProperties = Array.isArray(record.properties)
            ? record.properties
            : [];
        return [{
            id: record.id,
            name: optionalString(record.name) ?? record.id,
            properties: rawProperties.flatMap((property) => {
                const normalized = normalizeProperty(property);
                return normalized ? [normalized] : [];
            }),
        }];
    });
}

export function normalizeBuiltinPlugins(
    values: readonly (BuiltinPluginDefinition | UnknownRecord)[],
): BuiltinPluginDefinition[] {
    return values.flatMap((value) => {
        if (!isRecord(value) || typeof value.id !== 'string') return [];
        return [{
            description: optionalString(value.description) ?? '',
            group: optionalString(value.group) ?? '',
            icon: optionalString(value.icon) ?? 'Puzzle',
            id: value.id,
            name: optionalString(value.name) ?? value.id,
            requires: stringList(value.requires),
            routes: stringList(value.routes),
            settingsTab: optionalString(value.settingsTab),
        }];
    });
}

export function settingsRecord(value: unknown): UnknownRecord {
    return isRecord(value) ? value : {};
}

export function stringSetting(record: UnknownRecord, key: string): string {
    return optionalString(record[key]) ?? '';
}

export function numberSetting(
    record: UnknownRecord,
    key: string,
    fallback: number,
): number {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function stringArraySetting(
    record: UnknownRecord,
    key: string,
): readonly string[] {
    return stringList(record[key]);
}

export function apiErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

export function lifecycleConflict(error: unknown): LifecycleConflict | null {
    if (!isRecord(error)) return null;
    const response = error.response;
    if (!isRecord(response) || response.status !== 409 || !isRecord(response.data)) {
        return null;
    }
    const detail = response.data.detail;
    if (!isRecord(detail) || detail.code !== 'plugin_dependency_confirmation_required') {
        return null;
    }
    return {
        code: 'plugin_dependency_confirmation_required',
        disable: stringList(detail.disable),
        enable: stringList(detail.enable),
    };
}

export function readPendingPluginId(): string | null {
    const pluginId = readStorage(CONFIGURE_PLUGIN_KEY);
    if (pluginId) removeStorage(CONFIGURE_PLUGIN_KEY);
    return pluginId ?? null;
}

function parseVersion(value: string | null | undefined): number[] {
    return (value ?? '')
        .replace(/^v/i, '')
        .split(/[.-]/)
        .slice(0, 3)
        .map((part) => Number.parseInt(part, 10));
}

export function isNewerVersion(
    candidate: string | null | undefined,
    current: string | null | undefined,
): boolean {
    const next = parseVersion(candidate);
    const installed = parseVersion(current);
    if (next.some(Number.isNaN) || installed.some(Number.isNaN)) return false;
    const length = Math.max(next.length, installed.length);
    for (let index = 0; index < length; index += 1) {
        const nextPart = next[index] ?? 0;
        const installedPart = installed[index] ?? 0;
        if (nextPart !== installedPart) return nextPart > installedPart;
    }
    return false;
}

export const SELECT_STYLE = {
    background: 'var(--bg-primary, #fff)',
    border: '1px solid var(--border-primary, #e2e8f0)',
    borderRadius: 8,
    color: 'var(--text-primary, #0f172a)',
    fontSize: 13,
    padding: '8px 10px',
    width: '100%',
} as const;
