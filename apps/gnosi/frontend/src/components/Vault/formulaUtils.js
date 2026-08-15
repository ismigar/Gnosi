/**
 * formulaUtils.js
 * Utilities to evaluate simple formulas over the Vault's metadata.
 *
 * Supported expressions:
 *   {Camp}           → Value of a metadata field
 *   {Camp1} + {Camp2}→ Concatenation or sum
 *   prop('Camp')     → Alias for {Camp}
 *   Operators: +, -, *, /
 *   Functions: now(), today(), len({Camp}), if(cond, val1, val2)
 */

/**
 * Evaluates a formula expression over a record.
 * @param {string} formula - The formula expression
 * @param {Object} metadata - The record's metadata
 * @param {string} title - The record's title
 * @param {Object} options - Additional options
 * @returns {string|number|null}
 */
export function evaluateFormula(formula, metadata = {}, title = '') {
    if (!formula || typeof formula !== 'string') return null;

    try {
        let expr = formula.trim();

        // if(cond, val1, val2) → calls the actual `__IF` function injected into
        // the evaluation scope. This is done BEFORE substituting values (so that a
        // field value containing "if(" isn't confused with the function) and
        // as a real JS call, correctly handles the NESTING and the commas inside
        // of the arguments —something a simple regex couldn't do—. Without this,
        // `if(...)` used to reach `Function('return (if(...))')` as a statement
        // and it crashed → the formula returned `null` (the function was documented
        // but not implemented).
        expr = expr.replace(/\bif\s*\(/gi, '__IF(');

        // Substitute now() and today(). Date in LOCAL time (not `toISOString`, which
        // is UTC): near midnight the UTC date can be the previous day and the
        // date calculation in the formula (e.g. days until due) would come out
        // off by one day.
        const _now = new Date();
        const _pad = (n) => String(n).padStart(2, '0');
        const today = `${_now.getFullYear()}-${_pad(_now.getMonth() + 1)}-${_pad(_now.getDate())}`;
        expr = expr.replace(/\bnow\(\)/gi, `"${today}"`);
        expr = expr.replace(/\btoday\(\)/gi, `"${today}"`);

        // Substitute prop('Camp') with its value. `prop('Camp')` is an alias for
        // `{Camp}` (same documentation), so it must resolve the title using
        // the SAME names as the `{Camp}` handler further down: 'title' and
        // the Catalan alias 'Títol'. Previously it only recognized 'title', so
        // `prop('Títol')` used to return empty while `{Títol}` did give the title.
        expr = expr.replace(/\bprop\('([^']+)'\)/g, (_, name) => {
            const val = (name === 'title' || name === 'Títol') ? title : (metadata[name] ?? '');
            return typeof val === 'string' ? `"${val.replace(/"/g, '\\"')}"` : String(val ?? '');
        });

        // Substitute {Camp} with its value
        expr = expr.replace(/\{([^}]+)\}/g, (_, name) => {
            const val = name === 'title' || name === 'Títol' ? title : (metadata[name] ?? '');
            if (typeof val === 'number') return String(val);
            if (typeof val === 'boolean') return val ? '1' : '0';
            return `"${String(val ?? '').replace(/"/g, '\\"')}"`;
        });

        // Substitute len(...)
        expr = expr.replace(/\blen\("([^"]*)"\)/g, (_, s) => String(s.length));

        // Safe evaluation of simple numeric operations. `__IF` implements
        // if(cond, a, b) as a ternary (both branches are evaluated, which is
        // acceptable for side-effect-free value formulas).
        // A checkbox can be saved as a STRING "false" (or "0"); in JS "false"
        // is truthy, so `if({Checkbox}, …)` always took the branch
        // "true". We treat "false"/"0" (in addition to empty, null, 0, and false) as
        // falsy —consistent with how the checkbox is read in VaultTable
        // (`val !== 'false'`)— without altering any other non-empty text.
        const __IF = (cond, a, b) => {
            const falsy = cond == null || cond === false || cond === 0
                || cond === '' || cond === 'false' || cond === '0';
            return falsy ? b : a;
        };
        const result = Function('__IF', '"use strict"; return (' + expr + ')')(__IF);
        // A NON-FINITE numeric result is not a useful cell value, and `?? null`
        // doesn't catch it (NaN and Infinity are not null/undefined): `NaN` comes
        // from operating on non-numeric values ("12,5" * 2, or text - text) and
        // `Infinity` from a division by zero. We normalize them to null so the
        // cell ends up EMPTY —and sorts/filters as empty— instead of showing
        // "NaN"/"Infinity".
        if (typeof result === 'number' && !Number.isFinite(result)) return null;
        return result ?? null;
    } catch (_error) {
        return null;
    }
}
