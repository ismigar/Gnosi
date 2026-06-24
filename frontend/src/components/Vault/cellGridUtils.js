/**
 * cellGridUtils.js
 *
 * Helpers purs (sense estat ni React) per a la graella de cel·les del Vault:
 * navegació amb cursor, copiar/enganxar estil Notion/Excel i coerció de
 * valors per tipus de camp. Es mantenen aquí —separats de `VaultTable`— per
 * poder-los testejar amb Vitest sense muntar la taula ni tocar el disc.
 *
 * Vegeu la directiva: docs/dev_memory/directives/vault_table_cell_grid.md
 */

/** Tipus calculats o d'acció: mai s'editen ni s'enganxen. */
export function isComputedType(type) {
    return type === 'formula' || type === 'rollup' || type === 'virtual' || type === 'button';
}

/** Cert si una cel·la d'aquest tipus pot rebre un enganxat. */
export function isPasteableType(type) {
    // El `title` és navegable i editable cel·la a cel·la, però NO s'enganxa ni
    // es buida en bloc: viu a `note.title` (no a `metadata`) i el camí d'escriptura
    // massiva treballa sobre metadades. Excloure'l evita corrompre títols.
    return !isComputedType(type) && type !== 'files' && type !== 'title';
}

/**
 * Serialitza el valor d'una cel·la a text pla per al porta-retalls (TSV).
 * Els arrays (multi_select/relation) i autors es resolen a títols llegibles.
 */
export function serializeCellForClipboard(value, type, idToTitle = {}) {
    if (value === undefined || value === null) return '';

    if (type === 'autoria' && Array.isArray(value)) {
        return value
            .map(a => [a?.nom, a?.cognom1, a?.cognom2].filter(Boolean).join(' ').trim())
            .filter(Boolean)
            .join('; ');
    }

    if (Array.isArray(value)) {
        return value.map(v => String(idToTitle[v] ?? v ?? '')).filter(Boolean).join(', ');
    }

    if (typeof value === 'boolean') return value ? 'true' : 'false';

    return String(idToTitle[value] ?? value);
}

/**
 * Parseja text del porta-retalls a una matriu 2D (files × columnes).
 * Files separades per salt de línia, columnes per tabulador (format Excel/TSV).
 * Elimina una única fila buida final (típica del copiat de fulls de càlcul).
 */
export function parseClipboardMatrix(text) {
    if (typeof text !== 'string' || text === '') return [];
    let rows = text.split(/\r\n|\n|\r/);
    if (rows.length > 1 && rows[rows.length - 1] === '') rows = rows.slice(0, -1);
    return rows.map(line => line.split('\t'));
}

/** Casa un valor (id o títol) contra un catàleg d'opcions. Torna l'id o null. */
function matchOption(raw, options = [], idToTitle = {}) {
    const s = String(raw ?? '').trim();
    if (s === '') return null;
    if (options.includes(s)) return s;
    const lower = s.toLowerCase();
    for (const opt of options) {
        if (String(idToTitle[opt] ?? opt).trim().toLowerCase() === lower) return opt;
    }
    return null;
}

function isEmptyRaw(raw) {
    return (
        raw === undefined ||
        raw === null ||
        (typeof raw === 'string' && raw.trim() === '') ||
        (Array.isArray(raw) && raw.length === 0)
    );
}

const SKIP = Object.freeze({ skip: true });

/**
 * Coerceix un valor cru (d'un porta-retalls intern o de text extern) al tipus
 * de la columna destí. Torna `{ value }` amb el valor a desar, o `{ skip: true }`
 * si no es pot coercir sense corrompre la dada (la cel·la s'omet en enganxar).
 *
 * ctx: { options?: string[], idToTitle?: Record, relatedNotes?: {id,title}[] }
 */
export function coerceValueForField(raw, type, ctx = {}) {
    const { options = [], idToTitle = {}, relatedNotes = [] } = ctx;

    if (isComputedType(type) || type === 'files' || type === 'title') return SKIP;

    switch (type) {
        case 'number': {
            if (isEmptyRaw(raw)) return { value: '' };
            let n = typeof raw === 'number' ? raw : Number(String(raw).trim());
            // Decimal amb COMA (locale ca/es): "0,5" → 0.5. Només el cas
            // inequívoc (una sola coma, signe opcional, SENSE punt de milers)
            // per no haver d'endevinar "1.234,56" (milers+decimal) ni "1,2,3".
            // Sense això, enganxar un número en format local s'ometia en silenci.
            if (typeof raw === 'string' && !Number.isFinite(n)) {
                const s = raw.trim();
                if (/^-?\d+,\d+$/.test(s)) n = Number(s.replace(',', '.'));
            }
            return Number.isFinite(n) ? { value: n } : SKIP;
        }

        case 'checkbox': {
            if (typeof raw === 'boolean') return { value: raw };
            if (isEmptyRaw(raw)) return { value: false };
            const s = String(raw).trim().toLowerCase();
            const truthy = ['true', '1', 'sí', 'si', 'x', '✓', '✔', 'yes', 'on', 'done', 'completat'];
            const falsy = ['false', '0', 'no', 'off'];
            if (truthy.includes(s)) return { value: true };
            if (falsy.includes(s)) return { value: false };
            return SKIP;
        }

        case 'select':
        case 'status': {
            if (isEmptyRaw(raw)) return { value: '' };
            const matched = matchOption(raw, options, idToTitle);
            return matched != null ? { value: matched } : SKIP;
        }

        case 'multi_select': {
            const arr = Array.isArray(raw)
                ? raw.map(v => String(v))
                : String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
            if (arr.length === 0) return { value: [] };
            const matched = arr.map(v => matchOption(v, options, idToTitle)).filter(v => v != null);
            return matched.length > 0 ? { value: Array.from(new Set(matched)) } : SKIP;
        }

        case 'relation': {
            const arr = Array.isArray(raw)
                ? raw.map(v => String(v))
                : String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
            if (arr.length === 0) return { value: [] };
            const ids = new Set(relatedNotes.map(n => n.id));
            const titleToId = {};
            for (const n of relatedNotes) {
                titleToId[String(n.title ?? idToTitle[n.id] ?? n.id).trim().toLowerCase()] = n.id;
            }
            const matched = arr
                .map(v => {
                    const s = String(v).trim();
                    if (ids.has(s)) return s;
                    return titleToId[s.toLowerCase()] || null;
                })
                .filter(Boolean);
            return matched.length > 0 ? { value: Array.from(new Set(matched)) } : SKIP;
        }

        case 'date': {
            if (isEmptyRaw(raw)) return { value: '' };
            const s = String(raw).trim();
            // Conserva la data de calendari tal com s'escriu (també si ve d'un
            // datetime "YYYY-MM-DDT..."): NO passem per toISOString() perquè la
            // conversió a UTC pot desplaçar el dia (p. ex. amb offset +02:00).
            const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
            if (iso) return { value: iso[1] };
            const d = new Date(s);
            if (Number.isNaN(d.getTime())) return SKIP;
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return { value: `${yyyy}-${mm}-${dd}` };
        }

        case 'datetime': {
            if (isEmptyRaw(raw)) return { value: '' };
            const s = String(raw).trim();
            if (s.includes('T') && !Number.isNaN(new Date(s).getTime())) return { value: s };
            const d = new Date(s);
            return Number.isNaN(d.getTime()) ? SKIP : { value: d.toISOString() };
        }

        case 'period': {
            if (isEmptyRaw(raw)) return { value: '' };
            const s = String(raw).trim();
            return /^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/.test(s) ? { value: s } : SKIP;
        }

        case 'autoria': {
            // Només des d'una font interna estructurada; el text pla és ambigu.
            return Array.isArray(raw) ? { value: raw } : SKIP;
        }

        // text, url, zotero i qualsevol tipus desconegut → text pla.
        default:
            if (raw == null) return { value: '' };
            return { value: Array.isArray(raw) ? raw.join(', ') : String(raw) };
    }
}

/** Compara dos valors de cel·la (escalars o arrays plans) per detectar no-ops. */
export function sameCellValue(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((x, i) => x === b[i]);
    }
    return false;
}

// ── Geometria de rang ────────────────────────────────────────────────────

/** Llista d'enters inclusiva entre a i b (en qualsevol ordre). */
export function rangeBetween(a, b) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const out = [];
    for (let i = lo; i <= hi; i++) out.push(i);
    return out;
}

/** Limita un índex a [0, len-1]. */
export function clampIndex(i, len) {
    if (len <= 0) return 0;
    return Math.max(0, Math.min(i, len - 1));
}

/**
 * Calcula la geometria d'un enganxat estil Excel.
 *
 * @param {number} srcRows  files de la font (>=1)
 * @param {number} srcCols  columnes de la font (>=1)
 * @param {{r0,c0,r1,c1}} target  rectangle destí seleccionat (índexs inclusius)
 * @param {number} maxRows  files realment presents a la taula
 * @param {number} maxCols  columnes de la graella
 * @returns {{r0,c0,r1,c1}} rectangle efectiu on s'escriurà (retallat als límits)
 *
 * - Destí d'una sola cel·la → s'expandeix a la mida de la font (avall/dreta).
 * - Destí d'un rang → es respecta el rang (la font s'hi repeteix amb mòdul).
 */
export function computePasteRect(srcRows, srcCols, target, maxRows, maxCols) {
    const { r0, c0, r1, c1 } = target;
    const isSingle = r0 === r1 && c0 === c1;
    if (isSingle) {
        return {
            r0,
            c0,
            r1: clampIndex(r0 + srcRows - 1, maxRows),
            c1: clampIndex(c0 + srcCols - 1, maxCols),
        };
    }
    return { r0, c0, r1, c1 };
}
