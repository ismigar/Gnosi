import type {
    PluginLlmWikiMaintenanceResponse,
    PluginLlmWikiSettingsDocument,
    PluginLlmWikiSettingsResponse,
} from '../../../shared/api/plugins';
import type { VaultTable } from './pluginSettingsModel';
import { isRecord } from './pluginSettingsModel';

export type DimensionMode = 'ai' | 'source' | 'fixed' | 'empty';

export interface DimensionMapping {
    readonly fixed_value: string | readonly string[] | null;
    readonly mode: DimensionMode;
    readonly source_property_id: string;
}

export interface LlmWikiSource {
    readonly attachment_property_ids: readonly string[];
    readonly dimension_mappings: Readonly<Record<string, DimensionMapping>>;
    readonly include_body: boolean;
    readonly language_property_id: string;
    readonly relation_property_id: string;
    readonly table_id: string;
    readonly title_property_id: string;
    readonly url_property_ids: readonly string[];
}

export interface LlmWikiDraft {
    readonly brain_roles: Readonly<Record<string, unknown>>;
    readonly brain_table_id: string;
    readonly configured: boolean;
    readonly index_field_ids: readonly string[];
    readonly source_tables: readonly LlmWikiSource[];
    readonly target_table: string;
    readonly ui_locale?: string;
    readonly version: number;
}

export interface LlmWikiController {
    readonly brainTable: VaultTable | null;
    readonly busy: boolean;
    readonly confirmCreate: boolean;
    readonly createBrain: () => Promise<void>;
    readonly draft: LlmWikiDraft;
    readonly error: string;
    readonly lint: PluginLlmWikiMaintenanceResponse['lint'] | null;
    readonly lintBusy: boolean;
    readonly loading: boolean;
    readonly pendingSuggestions: number;
    readonly runLint: () => Promise<void>;
    readonly retrySave: () => Promise<void>;
    readonly retryLoad: () => Promise<void>;
    readonly runSemanticAudit: () => Promise<void>;
    readonly semanticBusy: boolean;
    readonly serverState: PluginLlmWikiSettingsResponse | null;
    readonly setConfirmCreate: (open: boolean) => void;
    readonly setDraft: (
        updater: (current: LlmWikiDraft) => LlmWikiDraft,
    ) => void;
    readonly tables: readonly VaultTable[];
}

export const EMPTY_LLM_WIKI_DRAFT: LlmWikiDraft = {
    brain_roles: {},
    brain_table_id: '',
    configured: false,
    index_field_ids: [],
    source_tables: [],
    target_table: '',
    version: 2,
};

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function stringList(value: unknown): readonly string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
}

function mode(value: unknown): DimensionMode {
    return value === 'source' || value === 'fixed' || value === 'empty' ? value : 'ai';
}

function mapping(value: unknown): DimensionMapping {
    if (!isRecord(value)) return { fixed_value: null, mode: 'ai', source_property_id: '' };
    const fixed = value.fixed_value;
    return {
        fixed_value: typeof fixed === 'string' || fixed === null || stringList(fixed).length > 0
            ? (typeof fixed === 'string' || fixed === null ? fixed : stringList(fixed))
            : null,
        mode: mode(value.mode),
        source_property_id: stringValue(value.source_property_id),
    };
}

function mappings(value: unknown): Readonly<Record<string, DimensionMapping>> {
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapping(item)]));
}

function source(value: unknown): LlmWikiSource | null {
    if (!isRecord(value) || typeof value.table_id !== 'string') return null;
    return {
        attachment_property_ids: stringList(value.attachment_property_ids),
        dimension_mappings: mappings(value.dimension_mappings),
        include_body: value.include_body === true,
        language_property_id: stringValue(value.language_property_id),
        relation_property_id: stringValue(value.relation_property_id),
        table_id: value.table_id,
        title_property_id: stringValue(value.title_property_id),
        url_property_ids: stringList(value.url_property_ids),
    };
}

export function normalizeLlmWikiDraft(value: unknown): LlmWikiDraft {
    if (!isRecord(value)) return EMPTY_LLM_WIKI_DRAFT;
    const sources = Array.isArray(value.source_tables) ? value.source_tables : [];
    return {
        brain_roles: isRecord(value.brain_roles) ? value.brain_roles : {},
        brain_table_id: stringValue(value.brain_table_id),
        configured: value.configured === true,
        index_field_ids: stringList(value.index_field_ids),
        source_tables: sources.flatMap((item) => {
            const normalized = source(item);
            return normalized ? [normalized] : [];
        }),
        target_table: stringValue(value.target_table),
        ui_locale: stringValue(value.ui_locale) || undefined,
        version: typeof value.version === 'number' ? value.version : 2,
    };
}

export function serializeLlmWikiDraft(draft: LlmWikiDraft): PluginLlmWikiSettingsDocument {
    return {
        brain_roles: draft.brain_roles,
        brain_table_id: draft.brain_table_id,
        configured: draft.configured,
        index_field_ids: [...draft.index_field_ids],
        source_tables: draft.source_tables.map((item) => ({
            ...item,
            attachment_property_ids: [...item.attachment_property_ids],
            dimension_mappings: item.dimension_mappings,
            url_property_ids: [...item.url_property_ids],
        })),
        target_table: draft.target_table,
        ui_locale: draft.ui_locale ?? 'en',
        version: draft.version,
    };
}

export function normalizeFieldName(value: string | undefined): string {
    return (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function detectLlmWikiSource(
    table: VaultTable,
    brainTable: VaultTable | null,
    indexFieldIds: readonly string[],
): LlmWikiSource {
    const title = table.properties.find((property) => property.type === 'title')
        ?? table.properties.find((property) => ['title', 'titol', 'nom', 'name'].includes(normalizeFieldName(property.name)));
    const files = table.properties.filter((property) => (
        ['files', 'file', 'attachment', 'attachments'].includes(property.type)
    ));
    const urls = table.properties.filter((property) => property.type === 'url'
        || (['text', 'rich_text'].includes(property.type)
            && ['url', 'enllac', 'link'].includes(normalizeFieldName(property.name))));
    const language = table.properties.find((property) => (
        ['language', 'idioma', 'llengua', 'lang'].includes(normalizeFieldName(property.name))
    ));
    const dimensionMappings = Object.fromEntries(indexFieldIds.map((fieldId) => {
        const brainProperty = brainTable?.properties.find((property) => property.id === fieldId);
        const sourceProperty = table.properties.find((property) => (
            normalizeFieldName(property.name) === normalizeFieldName(brainProperty?.name)
        ));
        return [fieldId, sourceProperty
            ? { fixed_value: null, mode: 'source' as const, source_property_id: sourceProperty.id }
            : { fixed_value: null, mode: 'ai' as const, source_property_id: '' }];
    }));
    return {
        attachment_property_ids: files.map((property) => property.id),
        dimension_mappings: dimensionMappings,
        include_body: false,
        language_property_id: language?.id ?? '',
        relation_property_id: '',
        table_id: table.id,
        title_property_id: title?.id ?? '',
        url_property_ids: urls.map((property) => property.id),
    };
}
