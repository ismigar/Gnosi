/**
 * formatUtils.js
 *
 * Pure helpers (no React) to format numbers (number/currency/percentage)
 * and dates according to a GLOBAL format (Settings) with a PER-FIELD override. Explicit
 * args → deterministically testable (`Intl` output
 * depends on locale, so tests must pass an explicit `locale`).
 *
 * The format is presentation-ONLY: numbers are stored as raw Number and
 * dates in ISO. See docs/dev_memory/directives/vault_field_formatting.md
 */

/** `'EUR (€)'` → `'EUR'`. Already accepts a code (`'USD'`) or with a symbol. */
export function parseCurrencyCode(raw, fallback = 'EUR') {
    if (!raw) return fallback;
    const m = String(raw).trim().match(/[A-Za-z]{3}/);
    return m ? m[0].toUpperCase() : fallback;
}

/**
 * Maps the decimal symbol to a formatting locale. `Intl` derives the
 * separators from the locale (it doesn't accept an arbitrary symbol), so instead of
 * doing fragile substitutions we pick a locale that uses the desired symbol.
 */
export function localeForDecimalSymbol(decimalSymbol) {
    if (decimalSymbol === '.') return 'en-US';
    if (decimalSymbol === ',') return 'de-DE';
    return undefined; // → the caller will use its default locale
}

function isEmpty(value) {
    return value === undefined || value === null
        // The number `NaN` (e.g. the result of a formula like `{Preu} * 2`
        // with a non-numeric value) is treated as EMPTY: `toNumber` leaves it
        // pass (`typeof NaN === 'number'`) and it ended up being displayed as "NaN%"
        // in the cell, contradicting `formatNumber`'s "never NaN" promise.
        || (typeof value === 'number' && Number.isNaN(value))
        || (typeof value === 'string' && value.trim() === '');
}

function toNumber(value) {
    if (typeof value === 'number') return value;
    const t = String(value).trim();
    // ca/es locale: a clean number with a comma decimal ("1,5", "-2,75") is stored
    // often as a STRING with a comma. `Number("1,5")` is NaN, so without this
    // the value used to be shown RAW (without currency symbol, decimals, or grouping).
    // Same criteria as the Vault's sort/filter/rollup engines.
    const n = /^-?\d+,\d+$/.test(t) ? Number(t.replace(',', '.')) : Number(t);
    return Number.isFinite(n) ? n : null;
}

/**
 * Formats a number for DISPLAY.
 * opts = { kind: 'number'|'currency'|'percent'|'year', decimals?, currencyCode?, locale? }
 * - Empty value → ''. Non-numeric value → the raw value (never "NaN").
 * - 'percent' shows the value AS-IS with a '%' suffix (does not multiply ×100).
 * - 'year' shows the integer without a thousands separator (2024, not 2.024).
 */
export function formatNumber(value, opts = {}) {
    if (isEmpty(value)) return '';
    const num = toNumber(value);
    if (num === null) return String(value);

    const { kind = 'number', decimals, currencyCode = 'EUR', locale } = opts;
    const fractionOpts = decimals != null
        ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
        : {};

    try {
        if (kind === 'currency') {
            return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode, ...fractionOpts }).format(num);
        }
        if (kind === 'percent') {
            const plain = new Intl.NumberFormat(locale, fractionOpts).format(num);
            return `${plain}%`;
        }
        if (kind === 'year') {
            return new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 0 }).format(num);
        }
        return new Intl.NumberFormat(locale, fractionOpts).format(num);
    } catch {
        // invalid currency code or bad locale: we don't crash, we show the raw value.
        return String(value);
    }
}

import { formatVaultDate, parseVaultDate } from './dateUtils';

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Formats a date for DISPLAY.
 * opts = { dateFormat: 'locale'|'DD/MM/YYYY'|'MM/DD/YYYY'|'YYYY-MM-DD', type, locale }
 * - Explicit formats are built using LOCAL components (not UTC) to avoid
 *   shifting the day. Invalid date → the raw value (never "Invalid Date").
 */
export function formatDate(value, opts = {}) {
    if (isEmpty(value)) return '';
    const { dateFormat = 'locale', type = 'date', locale } = opts;
    // A DATE-ONLY string ("YYYY-MM-DD") is parsed by `new Date()` as
    // UTC midnight; since we later read the LOCAL components (getDate…) or
    // format it with the local tz, the day shifts backward in zones with a
    // negative offset (e.g. America): "2024-10-04" would show up there as 03/10. We parse it
    // as LOCAL midnight so it always shows the literal day. Values with
    // a time (ISO datetime) are kept as before (correct tz conversion).
    const d = parseVaultDate(value);
    if (Number.isNaN(d.getTime())) return String(value);

    // Intl uses eras for years before 1 CE, which makes the persisted signed
    // representation ambiguous. Keep BCE values explicit in every locale.
    if (d.getFullYear() < 0) return formatVaultDate(d, { withTime: type === 'datetime' });

    if (dateFormat === 'locale') {
        try {
            return new Intl.DateTimeFormat(locale, {
                day: '2-digit', month: 'short', year: 'numeric',
                ...(type === 'datetime' ? { hour: '2-digit', minute: '2-digit' } : {}),
            }).format(d);
        } catch {
            return String(value);
        }
    }

    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    let datePart;
    if (dateFormat === 'YYYY-MM-DD') datePart = `${y}-${m}-${dd}`;
    else if (dateFormat === 'MM/DD/YYYY') datePart = `${m}/${dd}/${y}`;
    else datePart = `${dd}/${m}/${y}`; // 'DD/MM/YYYY' (explicit default)

    if (type === 'datetime') return `${datePart} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    return datePart;
}

/**
 * Merges the per-field format (`config.format`) over the global defaults.
 * `global` comes from useLocaleSettings: { currencyCode, dateFormat, numberLocale, dateLocale }.
 * Returns the options ready for formatNumber/formatDate.
 */
export function resolveFieldFormat(fieldConfig = {}, global = {}) {
    const f = (fieldConfig && fieldConfig.format) || {};
    return {
        kind: f.kind || 'number',
        decimals: f.decimals,
        currencyCode: f.currency ? parseCurrencyCode(f.currency) : (global.currencyCode || 'EUR'),
        dateFormat: f.dateFormat || global.dateFormat || 'locale',
        numberLocale: global.numberLocale,
        dateLocale: global.dateLocale,
    };
}
