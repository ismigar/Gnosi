/**
 * vaultFilters.js
 * Utilitats compartides de filtratge per al Vault i el Graf.
 */

// Valors que un checkbox considera "marcat" (paritat amb el backend:
// rule_engine._is_truthy_checkbox i view_snapshot._as_bool). Qualsevol altra
// cosa —camp absent, "", "false", 0…— és "no marcat".
const TRUTHY = new Set(['true', '1', 'yes', 'si', 'sí', 'done', 'checked', 'completat']);
function asBool(x) {
    if (x === true) return true;
    if (x === false || x === null || x === undefined || x === '') return false;
    if (typeof x === 'number') return x !== 0;
    return TRUTHY.has(String(x).trim().toLowerCase());
}

/**
 * Aplica una llista de filtres a una pàgina/node.
 * 
 * @param {Object} item - L'objecte a filtrar (pàgina del vault o node del graf)
 * @param {Array} filters - Llista de filtres [{ field, operator, value }]
 * @returns {boolean} - True si l'objecte compleix TOTS els filtres
 */
export function matchesFilters(item, filters = []) {
    if (!filters || filters.length === 0) return true;

    return filters.every(filter => {
        // Obtenir el valor del camp (suporta 'title' especial o metadata)
        const rawVal = filter.field === 'title'
            ? (item.title || item.label || '')
            : ((item.metadata || {})[filter.field] ?? (item[filter.field] ?? ''));
        
        const val = String(rawVal).toLowerCase();
        const filterVal = String(filter.value || '').toLowerCase();

        switch (filter.operator) {
            // Quan el valor del filtre és booleà (checkbox: "true"/"false"),
            // comparem per veritat —no per cadena— perquè un camp sense valor
            // compti com a "no marcat" i casi amb "false".
            case 'equals':
                if (filterVal === 'true' || filterVal === 'false') return asBool(rawVal) === (filterVal === 'true');
                return val === filterVal;
            case 'not_equals':
                if (filterVal === 'true' || filterVal === 'false') return asBool(rawVal) !== (filterVal === 'true');
                return val !== filterVal;
            case 'contains': return val.includes(filterVal);
            case 'not_contains': return !val.includes(filterVal);
            case 'is_empty': return !rawVal || rawVal === '';
            case 'is_not_empty': return rawVal && rawVal !== '';
            case 'greater_than': {
                const n1 = parseFloat(rawVal);
                const n2 = parseFloat(filterVal);
                return !isNaN(n1) && !isNaN(n2) && n1 > n2;
            }
            case 'less_than': {
                const n1 = parseFloat(rawVal);
                const n2 = parseFloat(filterVal);
                return !isNaN(n1) && !isNaN(n2) && n1 < n2;
            }
            default: return true;
        }
    });
}

/**
 * Normalitza un valor per a l'ordenació: descarta la puntuació i els
 * símbols inicials (¿ ? ¡ ! « » " ' - etc.) perquè «¿Què és?» ordeni
 * com «Què és» i no s'agrupi al principi per culpa del signe d'obertura.
 *
 * @param {*} value - El valor a normalitzar
 * @returns {string} - El valor sense puntuació/símbols inicials
 */
export function sortKey(value) {
    return String(value ?? '').replace(/^[\p{P}\p{S}\s]+/u, '');
}

/**
 * Aplica una cerca de text al títol i metadata.
 * 
 * @param {Object} item - L'objecte a cercar
 * @param {string} searchTerm - El text de cerca
 * @returns {boolean} - True si el text es troba a l'objecte
 */
export function matchesSearch(item, searchTerm = '') {
    if (!searchTerm || !searchTerm.trim()) return true;
    
    const q = searchTerm.toLowerCase();
    const title = (item.title || item.label || '').toLowerCase();
    if (title.includes(q)) return true;
    
    const metadata = item.metadata || {};
    return Object.values(metadata).some(v => String(v || '').toLowerCase().includes(q));
}
