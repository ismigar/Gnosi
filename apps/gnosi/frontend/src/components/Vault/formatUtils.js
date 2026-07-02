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
    return value === undefined || value === null
        // El número `NaN` (p. ex. el resultat d'una fórmula com `{Preu} * 2`
        // amb un valor no numèric) es tracta com a BUIT: `toNumber` el deixa
        // passar (`typeof NaN === 'number'`) i acabava mostrant-se com a "NaN%"
        // a la cel·la, contradint la promesa "mai NaN" de `formatNumber`.
        || (typeof value === 'number' && Number.isNaN(value))
        || (typeof value === 'string' && value.trim() === '');
}

function toNumber(value) {
    if (typeof value === 'number') return value;
    const t = String(value).trim();
    // locale ca/es: un número net amb decimal de coma ("1,5", "-2,75") es desa
    // sovint com a STRING amb coma. `Number("1,5")` és NaN, així que sense això
    // el valor es mostrava CRU (sense símbol de moneda, decimals ni agrupació).
    // Mateix criteri que els motors d'ordenació/filtre/rollup del Vault.
    const n = /^-?\d+,\d+$/.test(t) ? Number(t.replace(',', '.')) : Number(t);
    return Number.isFinite(n) ? n : null;
}

/**
 * Formata un número per a la VISUALITZACIÓ.
 * opts = { kind: 'number'|'currency'|'percent'|'year', decimals?, currencyCode?, locale? }
 * - Valor buit → ''. Valor no numèric → el valor cru (mai "NaN").
 * - 'percent' mostra el valor TAL QUAL amb sufix '%' (no multiplica ×100).
 * - 'year' mostra l'enter sense separador de milers (2024, no 2.024).
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
    // Una cadena de NOMÉS data ("YYYY-MM-DD") la parseja `new Date()` com a
    // mitjanit UTC; com que després en llegim els components LOCALS (getDate…) o
    // la formatem amb la tz local, el dia es desplaça enrere en zones amb offset
    // negatiu (p. ex. Amèrica): "2024-10-04" hi sortiria com a 03/10. La parsegem
    // com a mitjanit LOCAL perquè mostri sempre el dia literal. Els valors amb
    // hora (ISO datetime) es mantenen com abans (conversió de tz correcta).
    const d = (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()))
        ? new Date(value.trim() + 'T00:00:00')
        : new Date(value);
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
