import type {
    MetadataLookupResponse,
    PdfRecognitionResponse,
    UrlTranslationResponse,
} from '../../../shared/api/resource-lookup';
import { isFieldRelevantForType } from '../recursosZoteroMapping';
import {
    LABEL_TO_ZOTERO_TYPE,
    ZOTERO_TO_CSL_TYPE,
    ZOTERO_TYPE_LABELS,
} from '../zoteroSchema';
import { uiLangToZoteroLocale } from '../zoteroLocale';


export type MetadataRecord = Readonly<Record<string, unknown>>;
export type MetadataEntry = readonly [string, unknown];
export type MetadataLookupMode = 'create' | 'enrich';
export type RawLookupResult =
    | MetadataLookupResponse
    | PdfRecognitionResponse
    | UrlTranslationResponse;


export interface LookupResult {
    readonly error: string | null;
    readonly identifier: string | null;
    readonly source: string | null;
    readonly suggested: MetadataRecord;
}


export interface GroupedMetadataEntries {
    readonly fieldEntries: MetadataEntry[];
    readonly otherEntries: MetadataEntry[];
    readonly relevantEntries: MetadataEntry[];
    readonly zoteroType: string | null;
}


export const SOURCE_LABELS: Readonly<Record<string, string>> = {
    arxiv: 'arXiv (preprint)',
    crossref: 'CrossRef (DOI)',
    openlibrary: 'Open Library (ISBN)',
    pdf: 'PDF',
    pubmed: 'PubMed (PMID)',
    url: 'Open Graph / meta tags (URL)',
    web: 'Zotero translation-server (web)',
};


export function normalizeLookupResult(result: RawLookupResult): LookupResult {
    return {
        error: result.error,
        identifier: 'identifier' in result ? result.identifier : null,
        source: result.source,
        suggested: result.suggested,
    };
}


export function resolveZoteroType(raw: unknown): string | null {
    if (!raw || typeof raw !== 'string') return null;
    if (raw in ZOTERO_TO_CSL_TYPE) return raw;
    for (const labels of Object.values(LABEL_TO_ZOTERO_TYPE)) {
        const zoteroType = labels[raw];
        if (zoteroType) return zoteroType;
    }
    return null;
}


export function zoteroTypeLabel(
    zoteroType: string | null,
    uiLanguage?: string,
): string | null {
    if (!zoteroType) return null;
    const locale = uiLangToZoteroLocale(uiLanguage);
    return ZOTERO_TYPE_LABELS[locale]?.[zoteroType] ?? zoteroType;
}


export function groupMetadataEntries(
    suggested: MetadataRecord,
): GroupedMetadataEntries {
    const fieldEntries = Object.entries(suggested);
    const zoteroType = resolveZoteroType(suggested['Item Type']);
    const relevantEntries: MetadataEntry[] = [];
    const otherEntries: MetadataEntry[] = [];
    for (const entry of fieldEntries) {
        const [key] = entry;
        if (key === 'Item Type') continue;
        if (zoteroType && isFieldRelevantForType(key, zoteroType)) {
            relevantEntries.push(entry);
        } else {
            otherEntries.push(entry);
        }
    }
    return { fieldEntries, otherEntries, relevantEntries, zoteroType };
}


export const metadataValueIsEmpty = (value: unknown): boolean => (
    value === null
    || value === undefined
    || value === ''
    || (Array.isArray(value) && value.length === 0)
);


export const metadataScalarText = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (
        typeof value === 'number'
        || typeof value === 'bigint'
        || typeof value === 'boolean'
    ) {
        return String(value);
    }
    return '';
};


export const metadataDisplayText = (value: unknown): string => {
    const scalar = metadataScalarText(value);
    if (scalar || value === '') return scalar;
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) {
        return value.map(metadataDisplayText).filter(Boolean).join(', ');
    }
    try {
        return JSON.stringify(value);
    } catch {
        return '';
    }
};


export const initialFieldSelection = (
    suggested: MetadataRecord,
    current: MetadataRecord,
): Record<string, boolean> => Object.fromEntries(
    Object.keys(suggested).map((key) => [
        key,
        metadataValueIsEmpty(current[key]),
    ]),
);


export const selectedMetadataPatch = (
    suggested: MetadataRecord,
    selectedFields: Readonly<Record<string, boolean>>,
): Record<string, unknown> => Object.fromEntries(
    Object.entries(suggested).filter(([key]) => selectedFields[key]),
);
