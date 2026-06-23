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
        
        // Normalitza el valor a un array de strings —paritat 1:1 amb el motor
        // de snapshot del backend (view_snapshot.apply_filter) i el de les
        // vistes incrustades (DbViewEmbed.applyFilter)—. Un camp multi_select
        // (o una relació multivalor) arriba com a ARRAY: tractar-lo com una
        // sola cadena (`String(['a','b'])` → "a,b") feia que `equals` no casés
        // MAI (la vista principal amagava files que SÍ contenien el valor) i
        // que `not_equals` casés SEMPRE. Comparem per pertinença, en minúscules
        // (case-insensitive, coherent amb la resta del filtre).
        const arr = Array.isArray(rawVal)
            ? rawVal.map(x => String(x))
            : (rawVal === null || rawVal === undefined || rawVal === '' ? [] : [String(rawVal)]);
        const arrLower = arr.map(s => s.toLowerCase());
        const filterVal = String(filter.value || '').toLowerCase();

        switch (filter.operator) {
            // Quan el valor del filtre és booleà (checkbox: "true"/"false"),
            // comparem per veritat —no per cadena— perquè un camp sense valor
            // compti com a "no marcat" i casi amb "false".
            case 'equals':
                if (filterVal === 'true' || filterVal === 'false') return asBool(rawVal) === (filterVal === 'true');
                return arrLower.includes(filterVal);
            case 'not_equals':
                if (filterVal === 'true' || filterVal === 'false') return asBool(rawVal) !== (filterVal === 'true');
                return !arrLower.includes(filterVal);
            case 'contains': return arrLower.some(x => x.includes(filterVal));
            case 'not_contains': return !arrLower.some(x => x.includes(filterVal));
            case 'is_empty': return arr.length === 0;
            case 'is_not_empty': return arr.length > 0;
            case 'greater_than': {
                const n2 = parseFloat(filterVal);
                return !isNaN(n2) && arr.some(x => { const n1 = parseFloat(x); return !isNaN(n1) && n1 > n2; });
            }
            case 'less_than': {
                const n2 = parseFloat(filterVal);
                return !isNaN(n2) && arr.some(x => { const n1 = parseFloat(x); return !isNaN(n1) && n1 < n2; });
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
 * Comparador d'un sol camp per a l'ordenació de vistes. ÚNICA font de veritat
 * perquè la vista principal (useVaultViewData), les vistes incrustades
 * (DbViewEmbed.multiKeySort) i —idealment— el snapshot del backend
 * (view_snapshot.multi_key_sort) ordenin EXACTAMENT igual:
 *  - els valors BUITS van SEMPRE al final, independentment de la direcció
 *    (com a Notion); sense això una columna poc poblada feia surar les files
 *    buides al capdamunt en ordre ascendent.
 *  - si tots dos valors són NUMÈRICS, ordre numèric real (2 < 10, no "10" < "2").
 *  - si no, `localeCompare` amb normalització (sortKey), locale 'ca' i
 *    sensibilitat 'base' (insensible a accents/majúscules).
 * La direcció s'aplica NOMÉS a la part no-buida; el cridador no l'ha de negar.
 *
 * @param {*} aRaw - valor del camp de l'element A (escalar o array)
 * @param {*} bRaw - valor del camp de l'element B
 * @param {string} direction - 'asc' (per defecte) o 'desc'
 * @returns {number} negatiu si A va abans, positiu si després, 0 si empat
 */
export function compareFieldValues(aRaw, bRaw, direction = 'asc') {
    const aVal = String(aRaw ?? '');
    const bVal = String(bRaw ?? '');
    const aEmpty = aVal.trim() === '';
    const bEmpty = bVal.trim() === '';
    if (aEmpty || bEmpty) {
        if (aEmpty && bEmpty) return 0;
        return aEmpty ? 1 : -1; // buits sempre al final
    }
    const aNum = parseFloat(aVal);
    const bNum = parseFloat(bVal);
    const isNumeric = !isNaN(aNum) && !isNaN(bNum);
    let cmp = isNumeric
        ? aNum - bNum
        : sortKey(aVal).localeCompare(sortKey(bVal), 'ca', { sensitivity: 'base' });
    if (direction === 'desc') cmp = -cmp;
    return cmp;
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
