/**
 * Bidirectional mapping between Recursos columns and Zotero fields.
 *
 * It is NOT generated — it is Gnosi-specific knowledge (Catalan column names) tied to
 * Zotero's official naming. Exact mirror of
 * `backend/services/recursos_zotero_mapping.py`. Whenever one side is
 * modified, modify the other — the Py↔JS consistency tests do not cover
 * this module (it isn't generated), but drift here would break L2/L3.
 *
 * Why the values are arrays: a Recursos column can be fed
 * by different Zotero fields depending on the type. E.g. `Llibre/Revista` is
 * `publicationTitle` in a `journalArticle` but `bookTitle` in a
 * `bookSection`. The order within the array carries no preference.
 */
import { ITEM_TYPE_FIELDS } from './zoteroSchema';

export const RECURSOS_TO_ZOTERO_FIELDS = {
    'Item Type':       ['itemType'],
    'Title':           ['title'],
    'Authors':         ['creators'],
    'Any':             ['date'],
    'Llibre/Revista':  ['publicationTitle', 'bookTitle', 'proceedingsTitle', 'encyclopediaTitle'],
    'Editorial':       ['publisher'],
    'Lloc':            ['place'],
    'Volum':           ['volume'],
    'Número':          ['issue'],
    'Pàgines':         ['pages'],
    'Núm. pàgines':    ['numPages'],
    'Edició':          ['edition'],
    'DOI':             ['DOI'],
    'ISBN':            ['ISBN'],
    'ISSN':            ['ISSN'],
    'PMID':            ['PMID'],
    'URL':             ['url'],
    'Idioma':          ['language'],
};

// Inverse: zoteroField → first Recursos column that mentions it.
export const ZOTERO_FIELD_TO_RECURSOS = Object.fromEntries(
    Object.entries(RECURSOS_TO_ZOTERO_FIELDS).flatMap(
        ([col, fields]) => fields.map(f => [f, col])
    ),
);

/**
 * True if the Recursos column can be fed by any of the official
 * fields of the given `zoteroItemType`. False if the type doesn't exist or the
 * column has no Zotero mapping (show it under "Other fields").
 *
 * @param {string} recursosField  — frontmatter column name (ca-AD)
 * @param {string} zoteroItemType — canonical Zotero key (e.g. 'journalArticle')
 * @returns {boolean}
 */
export function isFieldRelevantForType(recursosField, zoteroItemType) {
    const candidates = RECURSOS_TO_ZOTERO_FIELDS[recursosField];
    if (!candidates) return false;
    const typeFields = ITEM_TYPE_FIELDS[zoteroItemType] || [];
    return candidates.some(c => typeFields.includes(c));
}
