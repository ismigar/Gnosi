/**
 * defaultFormulaUtils.js
 * Funcions per aplicar valors per defecte basats en fórmules als metadades
 * de les pàgines del Vault en el moment de creació.
 */

/**
 * Avalua una expressió de fórmula simple per a un camp per defecte.
 *
 * Fórmules suportades:
 *   - now()       → Data actual (ISO string)
 *   - {NomCamp}   → Valor del camp especificat dins de metadata
 *   - Qualsevol string literal
 *
 * @param {string} formula
 * @param {Object} context - { metadata, title, notes, currentTableId }
 * @returns {string|null}
 */
function evaluateDefaultFormula(formula, context = {}) {
    if (!formula || typeof formula !== 'string') return null;
    const expr = formula.trim();

    // now() → data actual
    if (/^now\(\)$/i.test(expr)) {
        return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    }

    // today() → mateix que now()
    if (/^today\(\)$/i.test(expr)) {
        return new Date().toISOString().slice(0, 10);
    }

    // {NomPropietat} → valor del metadat del registre actual
    const propRef = expr.match(/^\{(.+)\}$/);
    if (propRef) {
        const fieldName = propRef[1].trim();
        // Intenta primer del metadata, llavors del títol
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
 * Aplica les fórmules per defecte als metadades d'un registre nou,
 * omplint únicament els camps que estan buits o no definits.
 *
 * @param {Object} params
 * @param {Object} params.schema    - Esquema de la taula { fieldName: type, fieldName_config: {...} }
 * @param {Object} params.metadata  - Metadades actuals del registre
 * @param {string} params.title     - Títol del registre
 * @param {Array}  params.notes     - Llista de totes les notes (per a lookups futurs)
 * @param {string} params.currentTableId - ID de la taula actual
 * @returns {Object} - Metadades actualitzades
 */
export function applyDefaultFormulasToMetadata({ schema = {}, metadata = {}, title = '', notes = [], currentTableId = '' }) {
    const result = { ...metadata };

    Object.keys(schema).forEach(key => {
        // Saltar claus de configuració
        if (key.endsWith('_config')) return;

        const configKey = `${key}_config`;
        const config = schema[configKey] || {};

        // Aplicar defaultFormula si el camp és buit
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
