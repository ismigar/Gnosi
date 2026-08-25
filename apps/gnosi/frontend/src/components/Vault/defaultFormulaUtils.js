/**
 * defaultFormulaUtils.js
 * Functions to apply formula-based default values to the metadata
 * of Vault pages at creation time.
 */

// Today's date in LOCAL time (YYYY-MM-DD). We don't use `toISOString` (UTC):
// near midnight the UTC date can be the previous day and a record created
// in the early morning would receive yesterday's date as the default value.
const _localTodayStr = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Evaluates a simple formula expression for a default field.
 *
 * Supported formulas:
 *   - now()       → Current date (ISO string)
 *   - {NomCamp}   → Value of the specified field within metadata
 *   - Any literal string
 *
 * @param {string} formula
 * @param {Object} context - { metadata, title, notes, currentTableId }
 * @returns {string|null}
 */
function evaluateDefaultFormula(formula, context = {}) {
    if (!formula || typeof formula !== 'string') return null;
    const expr = formula.trim();

    // now() → data actual (local)
    if (/^now\(\)$/i.test(expr)) {
        return _localTodayStr(); // YYYY-MM-DD
    }

    // today() → same as now()
    if (/^today\(\)$/i.test(expr)) {
        return _localTodayStr();
    }

    // {NomPropietat} → value of the current record's metadata
    const propRef = expr.match(/^\{(.+)\}$/);
    if (propRef) {
        const fieldName = propRef[1].trim();
        // Tries the metadata first, then the title
        if (context.metadata && context.metadata[fieldName] !== undefined) {
            return String(context.metadata[fieldName]);
        }
        if (fieldName.toLowerCase() === 'title' || fieldName.toLowerCase() === 'títol') {
            return context.title || '';
        }
        return null;
    }

    // String literal
    return expr;
}

/**
 * Applies the default formulas to a new record's metadata,
 * filling in only the fields that are empty or undefined.
 *
 * @param {Object} params
 * @param {Object} params.schema    - Table schema { fieldName: type, fieldName_config: {...} }
 * @param {Object} params.metadata  - Current record metadata
 * @param {string} params.title     - Record title
 * @param {Array}  params.notes     - List of all notes (for future lookups)
 * @param {string} params.currentTableId - Current table ID
 * @returns {Object} - Updated metadata
 */
export function applyDefaultFormulasToMetadata({ schema = {}, metadata = {}, title = '', notes = [], currentTableId = '' }) {
    const result = { ...metadata };

    Object.keys(schema).forEach(key => {
        // Skip configuration keys
        if (key.endsWith('_config')) return;

        const configKey = `${key}_config`;
        const config = schema[configKey] || {};

        // Apply defaultFormula if the field is empty
        if (config.defaultFormula && (result[key] === undefined || result[key] === null || result[key] === '')) {
            const evaluated = evaluateDefaultFormula(config.defaultFormula, {
                metadata: result,
                title,
                notes,
                currentTableId,
            });
            if (evaluated !== null) {
                result[key] = evaluated;
            }
        }
    });

    return result;
}
