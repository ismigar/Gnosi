/**
 * Mapping bidireccional entre columnes de Recursos i camps de Zotero.
 *
 * NO és generat — és coneixement de Gnosi (columnes catalanes) lligat a la
 * nomenclatura oficial de Zotero. Mirall exacte de
 * `backend/services/recursos_zotero_mapping.py`. Sempre que es modifiqui
 * un costat, modificar l'altre — els tests de coherència Py↔JS no cobreixen
 * aquest mòdul (no és generat), però el seu drift trencaria L2/L3.
 *
 * Per què hi ha arrays als valors: una columna Recursos pot ser alimentada
 * per diferents camps Zotero segons el tipus. P. ex. `Llibre/Revista` és
 * `publicationTitle` en un `journalArticle` però `bookTitle` en un
 * `bookSection`. L'ordre dins l'array no és preferent.
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
    'Edició':          ['edition'],
    'DOI':             ['DOI'],
    'ISBN':            ['ISBN'],
    'ISSN':            ['ISSN'],
    'URL':             ['url'],
    'Idioma':          ['language'],
};

// Invers: zoteroField → primera columna Recursos que el mencioni.
export const ZOTERO_FIELD_TO_RECURSOS = Object.fromEntries(
    Object.entries(RECURSOS_TO_ZOTERO_FIELDS).flatMap(
        ([col, fields]) => fields.map(f => [f, col])
    ),
);

/**
 * True si la columna Recursos pot ser alimentada per qualsevol dels camps
 * oficials del `zoteroItemType` donat. False si el tipus no existeix o la
 * columna no té correspondència Zotero (mostra-la a "Altres camps").
 *
 * @param {string} recursosField  — nom de columna del frontmatter (ca-AD)
 * @param {string} zoteroItemType — clau canònica Zotero (p.ex. 'journalArticle')
 * @returns {boolean}
 */
export function isFieldRelevantForType(recursosField, zoteroItemType) {
    const candidates = RECURSOS_TO_ZOTERO_FIELDS[recursosField];
    if (!candidates) return false;
    const typeFields = ITEM_TYPE_FIELDS[zoteroItemType] || [];
    return candidates.some(c => typeFields.includes(c));
}
