/**
 * vaultFilters.js
 * Utilitats compartides de filtratge per al Vault i el Graf.
 */

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
            case 'equals': return val === filterVal;
            case 'not_equals': return val !== filterVal;
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
