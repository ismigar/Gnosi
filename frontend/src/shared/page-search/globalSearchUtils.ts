import {
    normalizeForSearch,
    type FilterValue,
} from '../filtering/vaultFilters';
import { isCalendarPage } from '../records/model/schemaUtils';

const TAG_FIELD_NAMES = new Set(['tags', 'tag', 'etiquetes', 'etiquetas', 'labels']);

type SearchOperator = 'is' | 'path' | 'tag' | 'title';

interface GlobalSearchKeyboardEvent {
    altKey: boolean;
    code: string;
    ctrlKey: boolean;
    key: string;
    metaKey: boolean;
    shiftKey: boolean;
}

type SearchMetadata = Readonly<Record<string, unknown>>;

interface SearchNote {
    folder?: FilterValue;
    id?: FilterValue;
    is_database?: boolean;
    metadata?: SearchMetadata | null;
    path?: FilterValue;
    resolved_table_id?: FilterValue;
    title?: FilterValue;
    [key: string]: unknown;
}

interface SearchTableProperty {
    config?: { role?: FilterValue };
    id?: FilterValue;
    name?: FilterValue;
    type?: string;
}

interface SearchTable {
    id?: FilterValue;
    properties?: readonly (SearchTableProperty | null | undefined)[] | null;
}

interface ParsedGlobalSearchQuery {
    operators: Record<SearchOperator, string[]>;
    regex: RegExp | null;
    terms: string[];
}

type SearchAliases = Readonly<Record<string, readonly string[]>>;
type TagFieldsByTable = ReadonlyMap<string, SearchTableProperty>;
type SearchTableEntry = SearchTable | null | undefined;

interface SearchGlobalNotesOptions<Note extends SearchNote> {
    aliasesById?: SearchAliases | null;
    limit?: number;
    notes?: readonly Note[] | null;
    query?: FilterValue;
    tables?: readonly SearchTableEntry[] | null;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

function stringifySearchValue(value: unknown): string {
    return Reflect.apply(String, undefined, [value]);
}

function isSearchOperator(value: string | undefined): value is SearchOperator {
    return value === 'tag'
        || value === 'path'
        || value === 'title'
        || value === 'is';
}

export function isGlobalSearchShortcut(
    event?: GlobalSearchKeyboardEvent | null,
): boolean {
    if (!event?.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return false;
    return event.code === 'KeyK' || stringifySearchValue(event.key || '').toLowerCase() === 'k';
}

export function mergeGlobalSearchNotes<Note extends SearchNote>(
    notes: readonly (Note | null | undefined)[] | null = [],
    globalIndex: Readonly<Record<string, FilterValue>> | null = {},
): Array<Note | SearchNote | null | undefined> {
    const merged: Array<Note | SearchNote | null | undefined> = [...(notes || [])];
    const knownIds = new Set(
        merged.map(note => stringifySearchValue(note?.id || '')).filter(Boolean),
    );

    Object.entries(globalIndex || {}).forEach(([id, title]) => {
        if (!id || knownIds.has(id)) return;
        merged.push({
            id,
            title: stringifySearchValue(title || id),
            metadata: {},
            folder: '',
        });
        knownIds.add(id);
    });

    return merged;
}

export function splitSearchTags(raw?: unknown): string[] {
    if (!raw) return [];
    const values = isUnknownArray(raw)
        ? raw
        : stringifySearchValue(raw).split(',');
    return values
        .map(value => normalizeForSearch(
            stringifySearchValue(value).replace(/^#/, '').trim(),
        ))
        .filter(Boolean);
}

export function findSearchTagsField(
    table?: SearchTable | null,
): SearchTableProperty | null {
    const properties = table?.properties || [];
    const explicit = properties.find(property => (
        stringifySearchValue(property?.config?.role || '').trim().toLowerCase() === 'tags'
    ));
    if (explicit) return explicit;
    return properties.find(property => (
        TAG_FIELD_NAMES.has(normalizeForSearch(property?.name))
        && property?.type === 'multi_select'
    )) || null;
}

export function buildTagFieldsByTable(
    tables: readonly SearchTableEntry[] | null = [],
): Map<string, SearchTableProperty> {
    const fields = new Map<string, SearchTableProperty>();
    (tables || []).forEach(table => {
        const field = findSearchTagsField(table);
        if (field && table?.id != null) {
            fields.set(stringifySearchValue(table.id), field);
        }
    });
    return fields;
}

export function getSearchNoteTags(
    note: SearchNote | null | undefined,
    tagFieldsByTable: TagFieldsByTable | null | undefined,
): string[] {
    const metadata = note?.metadata || {};
    const tags = splitSearchTags(metadata.tags);
    const tableId = note?.resolved_table_id || metadata.table_id || metadata.database_table_id;
    const field = tableId
        ? tagFieldsByTable?.get(stringifySearchValue(tableId))
        : null;
    if (field) {
        let raw = field.id != null
            ? metadata[stringifySearchValue(field.id)]
            : undefined;
        if (raw === undefined || raw === null) {
            raw = field.name
                ? metadata[stringifySearchValue(field.name)]
                : undefined;
        }
        tags.push(...splitSearchTags(raw));
    }
    return tags;
}

export function parseGlobalSearchQuery(query: FilterValue): ParsedGlobalSearchQuery {
    const tokens = stringifySearchValue(query).trim().split(/\s+/).filter(Boolean);
    const operators: Record<SearchOperator, string[]> = {
        tag: [],
        path: [],
        title: [],
        is: [],
    };
    const terms: string[] = [];
    let regex: RegExp | null = null;

    for (const token of tokens) {
        const regexMatch = token.match(/^\/(.+)\/([a-z]*)$/i);
        if (regexMatch) {
            const pattern = regexMatch[1];
            if (pattern === undefined) continue;
            try {
                regex = new RegExp(pattern, regexMatch[2] || 'i');
            } catch {
                // Ignore an incomplete regular expression while the user types.
            }
            continue;
        }
        const operatorMatch = token.match(/^(tag|path|title|is):(.+)$/i);
        if (operatorMatch) {
            const operator = operatorMatch[1]?.toLowerCase();
            const value = operatorMatch[2];
            if (isSearchOperator(operator) && value !== undefined) {
                operators[operator].push(value);
            }
            continue;
        }
        terms.push(token);
    }

    return { operators, terms, regex };
}

function noteAliases(
    note: SearchNote | null | undefined,
    aliasesById: SearchAliases | null,
): string[] {
    const noteId = stringifySearchValue(note?.id);
    return (aliasesById?.[noteId] || []).map(alias => normalizeForSearch(alias));
}

export function matchesGlobalSearchNote(
    note: SearchNote | null | undefined,
    parsed: ParsedGlobalSearchQuery,
    tagFieldsByTable: TagFieldsByTable,
    aliasesById: SearchAliases | null = {},
): boolean {
    const { operators, terms, regex } = parsed;
    const title = stringifySearchValue(note?.title || '');
    const titleNormalized = normalizeForSearch(title);
    const aliases = noteAliases(note, aliasesById);
    const folder = normalizeForSearch(note?.folder || note?.path || '');
    const tags = getSearchNoteTags(note, tagFieldsByTable);

    for (const tag of operators.tag) {
        const normalizedTag = normalizeForSearch(tag);
        if (!tags.some(value => value === normalizedTag || value.startsWith(`${normalizedTag}/`))) return false;
    }
    for (const path of operators.path) {
        if (!folder.includes(normalizeForSearch(path))) return false;
    }
    for (const titleTerm of operators.title) {
        const normalizedTitleTerm = normalizeForSearch(titleTerm);
        if (!titleNormalized.includes(normalizedTitleTerm)
            && !aliases.some(alias => alias.includes(normalizedTitleTerm))) return false;
    }
    for (const type of operators.is) {
        const normalizedType = normalizeForSearch(type);
        if (normalizedType === 'database' && !note?.is_database) return false;
        if (normalizedType === 'page' && note?.is_database) return false;
    }
    if (regex) {
        regex.lastIndex = 0;
        const titleMatches = regex.test(title);
        regex.lastIndex = 0;
        if (!titleMatches
            && !regex.test(stringifySearchValue(note?.folder || note?.path || ''))) return false;
    }

    return terms.every(term => {
        const normalizedTerm = normalizeForSearch(term);
        return titleNormalized.includes(normalizedTerm)
            || aliases.some(alias => alias.includes(normalizedTerm))
            || tags.some(tag => tag.includes(normalizedTerm));
    });
}

function globalSearchScore(
    note: SearchNote,
    parsed: ParsedGlobalSearchQuery,
    aliasesById: SearchAliases | null,
    tagFieldsByTable: TagFieldsByTable,
): number {
    const title = normalizeForSearch(note.title || '');
    const aliases = noteAliases(note, aliasesById);
    const tags = getSearchNoteTags(note, tagFieldsByTable);
    const freeText = normalizeForSearch(parsed.terms.join(' ')).trim();
    let score = 0;

    if (freeText) {
        if (title === freeText) score += 1000;
        else if (title.startsWith(freeText)) score += 800;
        else if (title.includes(freeText)) score += 600;

        if (aliases.some(alias => alias === freeText)) score += 550;
        else if (aliases.some(alias => alias.startsWith(freeText))) score += 450;
        else if (aliases.some(alias => alias.includes(freeText))) score += 350;
    }

    parsed.terms.forEach(term => {
        const normalizedTerm = normalizeForSearch(term);
        if (title.includes(normalizedTerm)) score += 100;
        else if (aliases.some(alias => alias.includes(normalizedTerm))) score += 60;
        else if (tags.some(tag => tag.includes(normalizedTerm))) score += 10;
    });

    return score;
}

export function searchGlobalNotes<Note extends SearchNote>({
    notes = [],
    query = '',
    tables = [],
    aliasesById = {},
    limit = 30,
}: SearchGlobalNotesOptions<Note>): Note[] {
    if (!stringifySearchValue(query).trim()) return [];
    const parsed = parseGlobalSearchQuery(query);
    const tagFieldsByTable = buildTagFieldsByTable(tables);

    return (notes || [])
        .map((note, index) => ({ note, index }))
        .filter(({ note }) => (
            !isCalendarPage(note)
            && matchesGlobalSearchNote(note, parsed, tagFieldsByTable, aliasesById)
        ))
        .map(candidate => ({
            ...candidate,
            score: globalSearchScore(candidate.note, parsed, aliasesById, tagFieldsByTable),
        }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, limit)
        .map(({ note }) => note);
}
