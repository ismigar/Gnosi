import {
    REFERENCE_DATE_SOURCES, REFERENCE_CREATOR_ROLES, REFERENCE_DATE_FIELDS, REFERENCE_TEXT_FIELDS,
    REFERENCE_ZOTERO_FIELDS, ZOTERO_CREATOR_COLUMNS,
} from '../../generated/referenceCatalog';
import { LABEL_TO_ZOTERO_TYPE } from './zoteroSchema';

type Metadata = Readonly<Record<string, unknown>>;
export const isMetadata = (value: unknown): value is Metadata => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
);

export function creatorRoles(metadata: Metadata): Readonly<Record<string, string>> {
    const roles = { ...REFERENCE_CREATOR_ROLES };
    if (isMetadata(metadata._citation_roles)) {
        for (const [name, role] of Object.entries(metadata._citation_roles)) {
            if (typeof role === 'string' && Object.values(REFERENCE_CREATOR_ROLES).includes(role)) roles[name] = role;
        }
    }
    return roles;
}

export function bibliographicValues(metadata: Metadata): Metadata {
    const values: Record<string, unknown> = { ...metadata };
    const extras = metadata['Zotero Extras'];
    if (!isMetadata(extras)) return values;
    for (const [column, sources] of Object.entries(REFERENCE_ZOTERO_FIELDS)) {
        if (column in values) continue;
        for (const source of sources) {
            if (extras[source] !== undefined && extras[source] !== null && extras[source] !== '') {
                values[column] = extras[source];
                break;
            }
        }
    }
    const rawType = typeof metadata['Item Type'] === 'string' ? metadata['Item Type'] : '';
    const type = ZOTERO_CREATOR_COLUMNS[rawType] ? rawType
        : Object.values(LABEL_TO_ZOTERO_TYPE).map((labels) => labels[rawType]).find(Boolean) ?? '';
    const columns = ZOTERO_CREATOR_COLUMNS[type] ?? {};
    const grouped: Record<string, Record<string, string>[]> = {};
    if (Array.isArray(extras.creators)) {
        for (const person of extras.creators) {
            if (!isMetadata(person)) continue;
            const column = columns[typeof person.creatorType === 'string' ? person.creatorType : 'author'];
            if (!column) continue;
            const text = (key: string): string => typeof person[key] === 'string' ? person[key] : '';
            const name = text('name');
            (grouped[column] ??= []).push({ nom: name || text('firstName'), cognom1: name ? '' : text('lastName'), cognom2: '' });
        }
        for (const [column, people] of Object.entries(grouped)) {
            if (!(column in values)) values[column] = people;
        }
    }
    return values;
}

export interface CslDate {
    readonly 'date-parts'?: readonly (readonly number[])[];
    readonly literal?: string;
}

export function cslDate(input: unknown): CslDate | null {
    const value = isMetadata(input) ? input.start || input.date : input;
    let raw = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    if (!raw) return null;
    const yearFirst = /^(\d{4})\s+([A-Za-z]+)(?:\s+(\d{1,2}))?$/.exec(raw);
    if (yearFirst) raw = `${yearFirst[2] ?? ''} ${yearFirst[3] || ''} ${yearFirst[1] ?? ''}`.replace('  ', ' ');
    const named = /^(?:(\d{1,2})\s+)?([A-Za-z]+)\s+(?:(\d{1,2}),?\s+)?(\d{4})$/.exec(raw);
    if (named) {
        const [, before, monthName = '', after, year = ''] = named;
        const months = 'january february march april may june july august september october november december'.split(' ');
        const month = months.findIndex((name) => [name, name.slice(0, 3)].includes(monthName.toLowerCase())) + 1;
        if (month && !(before && after)) raw = `${year}-${String(month).padStart(2, '0')}${before || after ? `-${String(before || after).padStart(2, '0')}` : ''}`;
    }
    const match = /^(-?\d{1,4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?(?:[T ][0-9:Z.+-]+)?\/?$/.exec(raw);
    if (!match) return { literal: raw };
    const parts = match.slice(1).filter(Boolean).map(Number);
    const [year = 0, month, day] = parts;
    if (month !== undefined && (month < 1 || month > 12)) return { literal: raw };
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day !== undefined && (day < 1 || day > (monthDays[(month ?? 1) - 1] ?? 31))) return { literal: raw };
    return { 'date-parts': [parts] };
}

function issuedDate(metadata: Metadata): CslDate | null {
    if (metadata['Data de publicació']) return cslDate(metadata['Data de publicació']);
    const year = metadata.Any;
    if (year === undefined || year === null || year === '') {
        const extras = metadata['Zotero Extras'];
        return cslDate(isMetadata(extras) ? REFERENCE_DATE_SOURCES.issued?.map((field) => extras[field]).find(Boolean) : null);
    }
    const parsed = cslDate(year);
    const initial = parsed?.['date-parts']?.[0];
    if (!initial) return parsed;
    const parts = [...initial];
    for (const [index, field] of ['Mes', 'Dia'].entries()) {
        const raw = metadata[field];
        if ((typeof raw !== 'string' && typeof raw !== 'number') || !/^\d{1,2}$/.test(String(raw))) break;
        parts[index + 1] = Number(raw);
    }
    return cslDate(parts.map((part, index) => index ? String(part).padStart(2, '0') : String(part)).join('-'));
}

export function bibliographicDetails(metadata: Metadata): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [column, variable] of Object.entries(REFERENCE_TEXT_FIELDS)) {
        const value = metadata[column];
        if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) result[variable] = String(value);
    }
    const issued = issuedDate(metadata);
    if (issued) result.issued = issued;
    for (const [column, variable] of Object.entries(REFERENCE_DATE_FIELDS)) {
        const value = cslDate(metadata[column]);
        if (value) result[variable] = value;
    }
    return result;
}
