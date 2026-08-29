import type { TFunction } from 'i18next';

import type {
    LiteratureRepositoryInput,
    LiteratureSource,
} from '../../shared/api/literature-resources';

export interface AcademicService {
    readonly badge: string;
    readonly docsUrl: string;
    readonly key: string;
    readonly name: string;
}

export interface RepositoryDraft extends LiteratureRepositoryInput {
    readonly id: string;
    readonly mapping: Record<string, string>;
    readonly static_filters: Record<string, string>;
}

export const ACADEMIC_SERVICES: readonly AcademicService[] = [
    { key: 'openalex_api_key', name: 'OpenAlex', badge: 'Gratuïta / Free', docsUrl: 'https://developers.openalex.org' },
    { key: 'semantic_scholar_api_key', name: 'Semantic Scholar', badge: 'Gratuïta / Academic', docsUrl: 'https://www.semanticscholar.org/product/api' },
    { key: 'core_api_key', name: 'CORE', badge: 'Gratuïta / Free', docsUrl: 'https://core.ac.uk/services/api' },
    { key: 'springer_nature_api_key', name: 'Springer Nature', badge: 'Institucional', docsUrl: 'https://dev.springernature.com/' },
    { key: 'scopus_api_key', name: 'Scopus', badge: 'Institucional', docsUrl: 'https://dev.elsevier.com/sc_apis.html' },
    { key: 'web_of_science_api_key', name: 'Web of Science', badge: 'Institucional', docsUrl: 'https://developer.clarivate.com/apis/wos' },
    { key: 'dimensions_api_key', name: 'Dimensions', badge: 'Subscripció', docsUrl: 'https://docs.dimensions.ai/dsl/' },
];

export const REST_MAPPING_FIELDS = [
    'provider_id', 'title', 'authors', 'date', 'year', 'abstract', 'type',
    'container', 'publisher', 'volume', 'issue', 'pages', 'language', 'doi',
    'pmid', 'pmcid', 'arxiv', 'isbn', 'url', 'pdf_url', 'is_oa', 'license',
    'peer_reviewed', 'citations',
] as const;

const DEFAULT_MAPPING: Record<string, string> = {
    title: 'title', authors: 'authors', year: 'year', abstract: 'abstract',
    type: 'type', container: 'container', publisher: 'publisher',
    language: 'language', doi: 'doi', pmid: 'pmid', arxiv: 'arxiv',
    isbn: 'isbn', url: 'url', pdf_url: 'pdf_url', is_oa: 'is_oa',
    license: 'license', citations: 'citations', provider_id: 'id',
};

export function emptyRepositoryDraft(): RepositoryDraft {
    return {
        id: '',
        name: '',
        kind: 'oai',
        base_url: '',
        metadata_prefix: 'oai_dc',
        set: '',
        sync_mode: 'incremental',
        tombstones: true,
        default_enabled: true,
        query_parameter: 'q',
        limit_parameter: 'limit',
        results_path: 'results',
        pagination: 'none',
        page_parameter: 'page',
        offset_parameter: 'offset',
        cursor_parameter: 'cursor',
        next_cursor_path: 'next_cursor',
        static_filters: {},
        mapping: { ...DEFAULT_MAPPING },
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sourceString(source: LiteratureSource, key: string, fallback = ''): string {
    const value = source[key];
    return typeof value === 'string' ? value : fallback;
}

function sourceBoolean(source: LiteratureSource, key: string, fallback: boolean): boolean {
    const value = source[key];
    return typeof value === 'boolean' ? value : fallback;
}

function sourceStringMap(source: LiteratureSource, key: string): Record<string, string> {
    const value = source[key];
    if (!isRecord(value)) return {};
    return Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => (
            typeof entry[1] === 'string'
        )),
    );
}

export function repositoryDraftFromSource(source: LiteratureSource): RepositoryDraft {
    const fallback = emptyRepositoryDraft();
    const kind = source.kind === 'rest' ? 'rest' : 'oai';
    const paginationValue = sourceString(source, 'pagination', fallback.pagination);
    const pagination = paginationValue === 'page'
        || paginationValue === 'offset'
        || paginationValue === 'cursor'
        || paginationValue === 'link'
        ? paginationValue
        : 'none';
    const syncMode = sourceString(source, 'sync_mode', fallback.sync_mode) === 'full'
        ? 'full'
        : 'incremental';
    return {
        ...fallback,
        id: source.id,
        name: source.name,
        kind,
        base_url: sourceString(source, 'base_url'),
        metadata_prefix: sourceString(source, 'metadata_prefix', fallback.metadata_prefix),
        set: sourceString(source, 'set'),
        sync_mode: syncMode,
        tombstones: sourceBoolean(source, 'tombstones', fallback.tombstones),
        default_enabled: sourceBoolean(source, 'default_enabled', fallback.default_enabled),
        query_parameter: sourceString(source, 'query_parameter', fallback.query_parameter),
        limit_parameter: sourceString(source, 'limit_parameter', fallback.limit_parameter),
        results_path: sourceString(source, 'results_path', fallback.results_path),
        pagination,
        page_parameter: sourceString(source, 'page_parameter', fallback.page_parameter),
        offset_parameter: sourceString(source, 'offset_parameter', fallback.offset_parameter),
        cursor_parameter: sourceString(source, 'cursor_parameter', fallback.cursor_parameter),
        next_cursor_path: sourceString(source, 'next_cursor_path', fallback.next_cursor_path),
        static_filters: sourceStringMap(source, 'static_filters'),
        mapping: { ...fallback.mapping, ...sourceStringMap(source, 'mapping') },
    };
}

export function repositoryPayload(
    draft: RepositoryDraft,
    staticFilters: Record<string, string>,
): LiteratureRepositoryInput {
    const { id: _id, ...payload } = draft;
    return { ...payload, static_filters: staticFilters };
}

export function staticFiltersText(filters: Readonly<Record<string, string>>): string {
    return Object.entries(filters).map(([key, value]) => `${key}=${value}`).join('\n');
}

export function parseStaticFilters(value: string): Record<string, string> {
    const entries: Array<[string, string]> = [];
    for (const rawLine of value.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const separator = line.indexOf('=');
        const key = (separator < 0 ? line : line.slice(0, separator)).trim();
        if (!key) continue;
        entries.push([key, separator < 0 ? '' : line.slice(separator + 1).trim()]);
    }
    return Object.fromEntries(entries);
}

export function sourceGroup(source: LiteratureSource): string {
    return sourceString(source, 'group');
}

export function sourceCredentialKey(source: LiteratureSource): string {
    return sourceString(source, 'credential_key')
        || sourceString(source, 'optional_credential_key');
}

export function sourceHasCredential(source: LiteratureSource): boolean {
    const group = sourceGroup(source);
    return Boolean(sourceCredentialKey(source) || group === 'credential' || group === 'subscription');
}

export function sourceCompleteListSize(source: LiteratureSource): number {
    const value = source.sync?.complete_list_size;
    return typeof value === 'number' ? value : 0;
}

export function sourceLastSuccessfulDatestamp(source: LiteratureSource): string {
    const value = source.sync?.last_successful_datestamp;
    return typeof value === 'string' ? value : '';
}

export function synchronizationActive(source: LiteratureSource): boolean {
    return source.kind === 'oai'
        && (source.sync?.state === 'queued' || source.sync?.state === 'running');
}

export function statusLabel(source: LiteratureSource, t: TFunction): string {
    if (source.kind === 'external') return t('literature.settings.external_only');
    if (source.kind === 'metric') return t('literature.settings.metric_only');
    if (source.credential_status === 'missing') return t('literature.settings.credential_missing');
    if (source.kind === 'oai' && source.sync?.state === 'running') return t('literature.settings.sync_state_running', 'En curs');
    if (source.kind === 'oai' && source.sync?.state === 'queued') return t('literature.settings.sync_state_queued', 'En cua');
    if (source.kind === 'oai' && !source.sync?.index_size) return t('literature.settings.index_empty');
    if (!source.implemented) return t('literature.settings.adapter_pending');
    return t('literature.settings.ready');
}

export function scrollCredentialIntoView(credentialKey: string): void {
    const element = document.getElementById(`credential-${credentialKey}`);
    if (!element) return;
    const scrollIntoView: unknown = Reflect.get(element, 'scrollIntoView');
    if (typeof scrollIntoView !== 'function') return;
    Reflect.apply(scrollIntoView, element, [{ behavior: 'smooth', block: 'nearest' }]);
}
