import type {
    NotionCloneProgress,
    NotionCloneResult,
    NotionDatabase,
    NotionLinkedDatabases,
    NotionVerification,
} from '../../../shared/api/notion-import';
import {
    defineStorageKey,
    jsonStorageCodec,
    readStorage,
    writeStorage,
} from '../../../shared/platform/browser-storage';
import type { VaultSummary } from '../../../shared/api/vaults';


export type NotionBusyAction =
    | ''
    | 'clone'
    | 'delclone'
    | 'linked'
    | 'list'
    | 'loose'
    | 'token'
    | 'verify'
    | `schema:${string}`;
export type LoosePageKind = 'dashboard' | 'wiki';
export type NotionSchema = Record<string, unknown>;
export type NotionSchemaOverrides = Record<string, NotionSchema>;


export interface LoosePage {
    readonly id: string;
    readonly title: string;
}


export interface NotionStoredConfig {
    readonly [key: string]: unknown;
    readonly cloneVaultId: string;
    readonly databases: readonly NotionDatabase[];
    readonly loosePageTypes: Readonly<Record<string, LoosePageKind>>;
    readonly loosePages: boolean;
    readonly looseSelected: readonly string[];
    readonly newVaultName: string;
    readonly schemaOverrides: NotionSchemaOverrides;
    readonly selected: readonly string[];
}


export interface NotionImportState {
    readonly busy: NotionBusyAction;
    readonly cloneVaultId: string;
    readonly connected: boolean | null;
    readonly databases: readonly NotionDatabase[];
    readonly destClone: { readonly tables: number } | null;
    readonly error: string;
    readonly linkedDbs: NotionLinkedDatabases | null;
    readonly loosePageTypes: Readonly<Record<string, LoosePageKind>>;
    readonly loosePages: boolean;
    readonly loosePagesList: readonly LoosePage[];
    readonly looseSelected: ReadonlySet<string>;
    readonly mcpConnected: boolean;
    readonly name: string;
    readonly newVaultName: string;
    readonly progress: NotionCloneProgress | null;
    readonly report: NotionCloneResult | null;
    readonly schemaOverrides: NotionSchemaOverrides;
    readonly selected: ReadonlySet<string>;
    readonly token: string;
    readonly usedVaultName: string;
    readonly vaults: readonly VaultSummary[];
    readonly verify: NotionVerification | null;
}


const DEFAULT_CONFIG: NotionStoredConfig = {
    cloneVaultId: '__new__',
    databases: [],
    loosePageTypes: {},
    loosePages: false,
    looseSelected: [],
    newVaultName: 'Notion',
    schemaOverrides: {},
    selected: [],
};


function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}


function strings(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
}


function databases(value: unknown): NotionDatabase[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is NotionDatabase => (
        isRecord(item)
        && typeof item.id === 'string'
        && typeof item.title === 'string'
    ));
}


function schemaOverrides(value: unknown): NotionSchemaOverrides {
    if (!isRecord(value)) return {};
    return Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, NotionSchema] => (
            isRecord(entry[1])
        )),
    );
}


function loosePageTypes(value: unknown): Record<string, LoosePageKind> {
    if (!isRecord(value)) return {};
    return Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, LoosePageKind] => (
            entry[1] === 'dashboard' || entry[1] === 'wiki'
        )),
    );
}


export function parseNotionConfig(value: unknown): NotionStoredConfig {
    if (!isRecord(value)) return DEFAULT_CONFIG;
    return {
        cloneVaultId: typeof value.cloneVaultId === 'string'
            ? value.cloneVaultId
            : '__new__',
        databases: sortNotionItems(databases(value.databases)),
        loosePageTypes: loosePageTypes(value.loosePageTypes),
        loosePages: value.loosePages === true,
        looseSelected: strings(value.looseSelected),
        newVaultName: typeof value.newVaultName === 'string'
            ? value.newVaultName
            : 'Notion',
        schemaOverrides: schemaOverrides(value.schemaOverrides),
        selected: strings(value.selected),
    };
}


const NOTION_CONFIG_KEY = defineStorageKey(
    'gnosi_notion_import_cfg',
    jsonStorageCodec<unknown>((_value): _value is unknown => true),
);


export function loadNotionConfig(): NotionStoredConfig {
    return parseNotionConfig(readStorage(NOTION_CONFIG_KEY));
}


export function persistNotionConfig(config: NotionStoredConfig): boolean {
    return writeStorage(NOTION_CONFIG_KEY, config);
}


export function sortNotionItems<T extends { readonly title: string }>(
    items: readonly T[] | null | undefined,
): T[] {
    return [...(items ?? [])].sort((left, right) => left.title.localeCompare(
        right.title,
        'en',
        { sensitivity: 'base' },
    ));
}


export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}


export function selectedLoosePageTypes(
    enabled: boolean,
    selected: ReadonlySet<string>,
    kinds: Readonly<Record<string, LoosePageKind>>,
): Record<string, LoosePageKind> | null {
    if (!enabled) return null;
    const result = Object.fromEntries(
        [...selected].map((id) => [id, kinds[id] ?? 'wiki']),
    );
    return Object.keys(result).length > 0 ? result : null;
}
