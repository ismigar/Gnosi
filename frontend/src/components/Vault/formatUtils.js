/**
 * formatUtils.js
 *
 * Helpers purs (sense React) per formatar números (número/moneda/percentatge)
 * i dates segons un format GLOBAL (Settings) amb override PER CAMP. Args
 * explícits → testejables de forma determinista (les sortides d'`Intl`
 * depenen del locale, així que els tests han de passar `locale` explícit).
 *
 * El format és NOMÉS de presentació: els números es desen com a Number cru i
 * les dates en ISO. Vegeu docs/dev_memory/directives/vault_field_formatting.md
 */

/** `'EUR (€)'` → `'EUR'`. Accepta ja un codi (`'USD'`) o amb símbol. */
export function parseCurrencyCode(raw, fallback = 'EUR') {
    if (!raw) return fallback;
    const m = String(raw).trim().match(/[A-Za-z]{3}/);
    return m ? m[0].toUpperCase() : fallback;
}

/**
 * Mapeja el símbol decimal a un locale de formatació. `Intl` deriva els
 * separadors del locale (no accepta un símbol arbitrari), així que en lloc de
 * fer substitucions fràgils triem un locale que usi el símbol desitjat.
 */
export function localeForDecimalSymbol(decimalSymbol) {
    if (decimalSymbol === '.') return 'en-US';
    if (decimalSymbol === ',') return 'de-DE';
    return undefined; // → el caller usarà el seu locale per defecte
}

function isEmpty(value) {
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function toNumber(value) {
    if (typeof value === 'number') return value;
    const n = Number(String(value).trim());
    return Number.isFinite(n) ? n : null;
}

/**
 * Formata un número per a la VISUALITZACIÓ.
 * opts = { kind: 'number'|'currency'|'percent', decimals?, currencyCode?, locale? }
 * - Valor buit → ''. Valor no numèric → el valor cru (mai "NaN").
 * - 'percent' mostra el valor TAL QUAL amb sufix '%' (no multiplica ×100).
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
        return new Intl.NumberFormat(locale, fractionOpts).format(num);
    } catch {
        // currency code invàlid o locale dolent: no petem, mostrem el cru.
        return String(value);
    }
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Formata una data per a la VISUALITZACIÓ.
 * opts = { dateFormat: 'locale'|'DD/MM/YYYY'|'MM/DD/YYYY'|'YYYY-MM-DD', type, locale }
 * - Els formats explícits es construeixen amb components LOCALS (no UTC) per no
 *   desplaçar el dia. Data invàlida → el valor cru (mai "Invalid Date").
 */
export function formatDate(value, opts = {}) {
    if (isEmpty(value)) return '';
    const { dateFormat = 'locale', type = 'date', locale } = opts;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);

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
    else datePart = `${dd}/${m}/${y}`; // 'DD/MM/YYYY' (per defecte explícit)

    if (type === 'datetime') return `${datePart} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    return datePart;
}

/**
 * Fusiona el format per camp (`config.format`) sobre els defaults globals.
 * `global` ve de useLocaleSettings: { currencyCode, dateFormat, numberLocale, dateLocale }.
 * Torna les opcions llestes per a formatNumber/formatDate.
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
