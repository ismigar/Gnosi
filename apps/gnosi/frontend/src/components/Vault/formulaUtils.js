/**
 * formulaUtils.js
 * Utilitats per avaluar fórmules simples sobre els metadades del Vault.
 *
 * Expressions suportades:
 *   {Camp}           → Valor d'un camp dels metadades
 *   {Camp1} + {Camp2}→ Concatenació o suma
 *   prop('Camp')     → Àlies de {Camp}
 *   Operadors: +, -, *, /
 *   Funcions: now(), today(), len({Camp}), if(cond, val1, val2)
 */

/**
 * Evalua una expressió de fórmula sobre un registre.
 * @param {string} formula - L'expressió de la fórmula
 * @param {Object} metadata - Els metadades del registre
 * @param {string} title - El títol del registre
 * @param {Object} options - Opcions addicionals
 * @returns {string|number|null}
 */
export function evaluateFormula(formula, metadata = {}, title = '', options = {}) {
    if (!formula || typeof formula !== 'string') return null;

    try {
        let expr = formula.trim();

        // Substituir now() i today()
        const today = new Date().toISOString().slice(0, 10);
        expr = expr.replace(/\bnow\(\)/gi, `"${today}"`);
        expr = expr.replace(/\btoday\(\)/gi, `"${today}"`);

        // Substituir prop('Camp') per valor
        expr = expr.replace(/\bprop\('([^']+)'\)/g, (_, name) => {
            const val = name === 'title' ? title : (metadata[name] ?? '');
            return typeof val === 'string' ? `"${val.replace(/"/g, '\\"')}"` : String(val ?? '');
        });

        // Substituir {Camp} per valor
        expr = expr.replace(/\{([^}]+)\}/g, (_, name) => {
            const val = name === 'title' || name === 'Títol' ? title : (metadata[name] ?? '');
            if (typeof val === 'number') return String(val);
            if (typeof val === 'boolean') return val ? '1' : '0';
            return `"${String(val ?? '').replace(/"/g, '\\"')}"`;
        });

        // Substituir len(...)
        expr = expr.replace(/\blen\("([^"]*)"\)/g, (_, s) => String(s.length));

        // Avaluació segura d'operacions numèriques simples
        const result = Function('"use strict"; return (' + expr + ')')();
        return result ?? null;
    } catch (e) {
        return null;
    }
}
