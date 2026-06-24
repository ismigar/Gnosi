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
// parseFloat no entén els decimals amb coma (locale ca/es): parseFloat("0,25")=0,
// parseFloat("1,5")=1, així que sum/avg/min/max d'un rollup sobre un camp numèric
// amb comes sortien mal. Si el valor és un número net amb decimal de coma, el
// passem a punt; si no, fallback a parseFloat (gestiona "1.5", enters i signe).
// Mateix criteri que els motors d'ordenació/filtre/agregat de columna del Vault.
function parseNumericValue(v) {
    const t = String(v).trim();
    return /^-?\d+,\d+$/.test(t) ? Number(t.replace(',', '.')) : parseFloat(t);
}

export function evaluateRollup(values = [], aggregation = 'count_all') {
    const numericValues = values.map(parseNumericValue).filter(v => !isNaN(v));
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
