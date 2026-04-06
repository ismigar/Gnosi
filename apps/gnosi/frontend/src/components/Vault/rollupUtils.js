/**
 * rollupUtils.js
 * Utilitats per calcular rollups (agregacions) sobre registres relacionats del Vault.
 */

/**
 * Calcula un rollup sobre una llista de valors.
 * @param {Array} values - Llista de valors sobre els quals agregar
 * @param {string} aggregation - Tipus d'agregació
 * @returns {string|number}
 */
export function evaluateRollup(values = [], aggregation = 'count_all') {
    const numericValues = values.map(v => parseFloat(v)).filter(v => !isNaN(v));
    const nonEmptyValues = values.filter(v => v !== null && v !== undefined && v !== '');

    switch (aggregation) {
        case 'count_all':
            return values.length;
        case 'count_values':
            return nonEmptyValues.length;
        case 'sum':
            return numericValues.reduce((a, b) => a + b, 0);
        case 'avg':
            return numericValues.length ? (numericValues.reduce((a, b) => a + b, 0) / numericValues.length).toFixed(2) : 0;
        case 'min':
            return numericValues.length ? Math.min(...numericValues) : null;
        case 'max':
            return numericValues.length ? Math.max(...numericValues) : null;
        case 'unique_count':
            return new Set(nonEmptyValues.map(v => String(v))).size;
        case 'percent_checked':
            if (!values.length) return '0%';
            const checked = values.filter(v => v === true || v === 'true' || v === 1).length;
            return `${Math.round((checked / values.length) * 100)}%`;
        case 'earliest':
            return nonEmptyValues.length ? nonEmptyValues.sort()[0] : null;
        case 'latest':
            return nonEmptyValues.length ? nonEmptyValues.sort().reverse()[0] : null;
        case 'show_original':
            return nonEmptyValues.join(', ');
        default:
            return values.length;
    }
}
