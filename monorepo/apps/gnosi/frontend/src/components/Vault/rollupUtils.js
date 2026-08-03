/**
 * rollupUtils.js
 * Utilities for computing rollups (aggregations) over related Vault records.
 */
import { asBool } from '../../utils/vaultFilters';

/**
 * Computes a rollup over a list of values.
 * @param {Array} values - List of values to aggregate over
 * @param {string} aggregation - Aggregation type
 * @returns {string|number}
 */
// parseFloat doesn't understand comma decimals (ca/es locale): parseFloat("0,25")=0,
// parseFloat("1,5")=1, so sum/avg/min/max of a rollup over a numeric field
// with commas came out wrong. If the value is a clean number with a comma decimal, we
// convert it to a dot; otherwise, fall back to parseFloat (handles "1.5", integers, and sign).
// Same criteria as the Vault's column sort/filter/aggregate engines.
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
        case 'percent_checked': {
            if (!values.length) return '0%';
            // Parity with the 3 filter engines (asBool/_as_bool/_is_truthy_checkbox):
            // a checkbox stored as 'yes'/'sí'/'done'/'checked'/'completat'
            // also counts as checked, not just `true`/'true'/1.
            const checked = values.filter(asBool).length;
            return `${Math.round((checked / values.length) * 100)}%`;
        }
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
