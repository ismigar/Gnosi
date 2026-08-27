import { normalizeForSearch } from '../../utils/vaultFilters';
import { isCalendarPage } from './schemaUtils';

const TAG_FIELD_NAMES = new Set(['tags', 'tag', 'etiquetes', 'etiquetas', 'labels']);

export function isGlobalSearchShortcut(event) {
    if (!event?.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return false;
    return event.code === 'KeyK' || String(event.key || '').toLowerCase() === 'k';
}

export function mergeGlobalSearchNotes(notes = [], globalIndex = {}) {
    const merged = [...(notes || [])];
    const knownIds = new Set(merged.map(note => String(note?.id || '')).filter(Boolean));

    Object.entries(globalIndex || {}).forEach(([id, title]) => {
        if (!id || knownIds.has(String(id))) return;
        merged.push({ id, title: String(title || id), metadata: {}, folder: '' });
        knownIds.add(String(id));
    });

    return merged;
}

export function splitSearchTags(raw) {
    if (!raw) return [];
    const values = Array.isArray(raw) ? raw : String(raw).split(',');
    return values
        .map(value => normalizeForSearch(String(value).replace(/^#/, '').trim()))
        .filter(Boolean);
}

export function findSearchTagsField(table) {
    const properties = table?.properties || [];
    const explicit = properties.find(property => (
        String(property?.config?.role || '').trim().toLowerCase() === 'tags'
    ));
    if (explicit) return explicit;
    return properties.find(property => (
        TAG_FIELD_NAMES.has(normalizeForSearch(property?.name))
        && property?.type === 'multi_select'
    )) || null;
}

export function buildTagFieldsByTable(tables = []) {
    const fields = new Map();
    (tables || []).forEach(table => {
        const field = findSearchTagsField(table);
        if (field && table?.id != null) fields.set(String(table.id), field);
    });
    return fields;
}

export function getSearchNoteTags(note, tagFieldsByTable) {
    const metadata = note?.metadata || {};
    const tags = splitSearchTags(metadata.tags);
    const tableId = note?.resolved_table_id || metadata.table_id || metadata.database_table_id;
    const field = tableId ? tagFieldsByTable?.get(String(tableId)) : null;
    if (field) {
        let raw = field.id != null ? metadata[field.id] : undefined;
        if (raw === undefined || raw === null) raw = field.name ? metadata[field.name] : undefined;
        tags.push(...splitSearchTags(raw));
    }
    return tags;
}

export function parseGlobalSearchQuery(query) {
    const tokens = String(query).trim().split(/\s+/).filter(Boolean);
    const operators = { tag: [], path: [], title: [], is: [] };
    const terms = [];
    let regex = null;

    for (const token of tokens) {
        const regexMatch = token.match(/^\/(.+)\/([a-z]*)$/i);
        if (regexMatch) {
            try {
                regex = new RegExp(regexMatch[1], regexMatch[2] || 'i');
            } catch {
                // Ignore an incomplete regular expression while the user types.
            }
            continue;
        }
        const operatorMatch = token.match(/^(tag|path|title|is):(.+)$/i);
        if (operatorMatch) {
            operators[operatorMatch[1].toLowerCase()].push(operatorMatch[2]);
            continue;
        }
        terms.push(token);
    }

    return { operators, terms, regex };
}

function noteAliases(note, aliasesById) {
    return (aliasesById?.[note?.id] || []).map(alias => normalizeForSearch(alias));
}

export function matchesGlobalSearchNote(note, parsed, tagFieldsByTable, aliasesById = {}) {
    const { operators, terms, regex } = parsed;
    const title = String(note?.title || '');
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
        if (!titleMatches && !regex.test(String(note?.folder || note?.path || ''))) return false;
    }

    return terms.every(term => {
        const normalizedTerm = normalizeForSearch(term);
        return titleNormalized.includes(normalizedTerm)
            || aliases.some(alias => alias.includes(normalizedTerm))
            || tags.some(tag => tag.includes(normalizedTerm));
    });
}

function globalSearchScore(note, parsed, aliasesById, tagFieldsByTable) {
    const title = normalizeForSearch(note?.title || '');
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

export function searchGlobalNotes({
    notes = [],
    query = '',
    tables = [],
    aliasesById = {},
    limit = 30,
}) {
    if (!String(query).trim()) return [];
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
