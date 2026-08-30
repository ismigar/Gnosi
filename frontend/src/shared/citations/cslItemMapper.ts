import {
    LABEL_TO_ZOTERO_TYPE,
    ZOTERO_TO_CSL_TYPE,
} from './zoteroSchema';

type MetadataRecord = Readonly<Record<string, unknown>>;

export interface CslName {
    readonly family?: string;
    readonly given?: string;
    readonly literal?: string;
}

export interface CslItem {
    readonly [key: string]: unknown;
    readonly author?: readonly CslName[];
    readonly id: string;
    readonly title: string;
    readonly type: string;
}

export type CslItemMap = Readonly<Record<string, CslItem>>;

export interface VaultResourcePage {
    readonly metadata?: unknown;
    readonly title?: unknown;
}

interface StructuredAuthor {
    readonly cognom1?: string;
    readonly cognom2?: string;
    readonly nom?: string;
}

const zoteroToCslType: Readonly<Record<string, string>> = ZOTERO_TO_CSL_TYPE;
const labelToZoteroType: Readonly<
    Record<string, Readonly<Record<string, string>>>
> = LABEL_TO_ZOTERO_TYPE;

const LEGACY_TYPE_ALIASES: Readonly<Record<string, string>> = {
    'Article científic': 'article-journal',
    'Article de revista': 'article-journal',
    'Article divulgatiu': 'article-magazine',
    Tesis: 'thesis',
    Manual: 'book',
    'Secció de Llibre': 'chapter',
    Ponència: 'paper-conference',
    Curs: 'document',
    Relat: 'document',
    Document: 'document',
    Vídeo: 'motion_picture',
    'Entrevista/testimoni': 'interview',
};

function isRecord(value: unknown): value is MetadataRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalarText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (
        typeof value === 'number'
        || typeof value === 'bigint'
        || typeof value === 'boolean'
    ) {
        return String(value);
    }
    return '';
}

export function resolveCslType(raw: unknown): string {
    if (typeof raw !== 'string' || !raw) return 'document';
    const canonical = zoteroToCslType[raw];
    if (canonical) return canonical;
    for (const labels of Object.values(labelToZoteroType)) {
        const zoteroType = labels[raw];
        if (!zoteroType) continue;
        const resolved = zoteroToCslType[zoteroType];
        if (resolved) return resolved;
    }
    return 'document';
}

function parseAuthors(authors: unknown): CslName[] {
    if (typeof authors !== 'string' || !authors) return [];
    const parts = authors.includes(';')
        ? authors.split(';').map((part) => part.trim()).filter(Boolean)
        : [authors.trim()];
    const output: CslName[] = [];
    for (const part of parts) {
        if (/,\s/.test(part) && part.split(',').length === 2) {
            const [family = '', given = ''] = part
                .split(',')
                .map((namePart) => namePart.trim());
            if (family) output.push({ family, given });
            continue;
        }
        if (part.includes(',')) {
            for (const author of part.split(',').map((value) => value.trim()).filter(Boolean)) {
                const tokens = author.split(/\s+/);
                const family = tokens.at(-1);
                if (!family) continue;
                output.push(tokens.length === 1
                    ? { family }
                    : { family, given: tokens.slice(0, -1).join(' ') });
            }
            continue;
        }
        const tokens = part.split(/\s+/);
        const family = tokens.at(-1);
        if (!family) continue;
        output.push(tokens.length === 1
            ? { family }
            : { family, given: tokens.slice(0, -1).join(' ') });
    }
    return output;
}

function isStructuredAuthor(value: unknown): value is StructuredAuthor {
    if (!isRecord(value)) return false;
    return (
        typeof value.cognom1 === 'string'
        || typeof value.cognom2 === 'string'
        || typeof value.nom === 'string'
    );
}

function findStructuredAuthors(metadata: MetadataRecord): StructuredAuthor[] | null {
    for (const value of Object.values(metadata)) {
        if (!Array.isArray(value)) continue;
        const structured = value.filter(isStructuredAuthor);
        if (structured.length > 0) return structured;
    }
    return null;
}

function structuredAuthorsToCsl(authors: readonly StructuredAuthor[]): CslName[] {
    const output: CslName[] = [];
    for (const author of authors) {
        const family = [author.cognom1, author.cognom2]
            .map((surname) => surname?.trim() ?? '')
            .filter(Boolean)
            .join(' ');
        const given = author.nom?.trim() ?? '';
        if (!family && !given) continue;
        if (!family) output.push({ literal: given });
        else output.push({ family, ...(given ? { given } : {}) });
    }
    return output;
}

function optionalScalar(metadata: MetadataRecord, key: string): string {
    return scalarText(metadata[key]);
}

export function recursosPageToCsl(page: VaultResourcePage | null): CslItem | null {
    if (!page) return null;
    const metadata = isRecord(page.metadata) ? page.metadata : {};
    const id = optionalScalar(metadata, 'Citation Key');
    if (!id) return null;
    const typeRaw = optionalScalar(metadata, 'Item Type');
    const type = LEGACY_TYPE_ALIASES[typeRaw] || resolveCslType(typeRaw);
    const title = scalarText(page.title) || optionalScalar(metadata, 'Title');
    const item: Record<string, unknown> & {
        author?: readonly CslName[];
        id: string;
        title: string;
        type: string;
    } = { id, title, type };

    const structured = findStructuredAuthors(metadata);
    const authors = structured
        ? structuredAuthorsToCsl(structured)
        : parseAuthors(metadata.Authors);
    if (authors.length > 0) item.author = authors;

    const yearRaw = optionalScalar(metadata, 'Any').trim();
    const yearMatch = yearRaw.match(/-?\d{1,4}/);
    const year = yearMatch?.at(0);
    if (year) item.issued = { 'date-parts': [[Number(year)]] };
    else if (yearRaw) item.issued = { literal: yearRaw };

    const directFields: Readonly<Record<string, string>> = {
        'Llibre/Revista': 'container-title',
        Editorial: 'publisher',
        Lloc: 'publisher-place',
        Volum: 'volume',
        Número: 'issue',
        Pàgines: 'page',
        Edició: 'edition',
        DOI: 'DOI',
        ISBN: 'ISBN',
        ISSN: 'ISSN',
        URL: 'URL',
        Idioma: 'language',
    };
    for (const [metadataKey, cslKey] of Object.entries(directFields)) {
        const value = optionalScalar(metadata, metadataKey);
        if (value) item[cslKey] = value;
    }
    return item;
}
