/**
 * cellGridUtils.js
 *
 * Pure helpers (no state, no React) for the Vault's cell grid:
 * cursor navigation, Notion/Excel-style copy/paste, and coercion of
 * values by field type. Kept here — separate from `VaultTable` — so
 * they can be tested with Vitest without mounting the table or touching disk.
 *
 * See the directive: docs/dev_memory/directives/vault_table_cell_grid.md
 */
import { parsePeriod, serializePeriod } from '../../utils/projectPlanning';

/** Computed or action types: never edited or pasted. */
export function isComputedType(type) {
    return type === 'formula' || type === 'rollup' || type === 'virtual' || type === 'button';
}

/** True if a cell of this type can receive a paste. */
export function isPasteableType(type) {
    // The `title` is navigable and editable cell by cell, but it's NOT pasted or
    // cleared in bulk: it lives in `note.title` (not in `metadata`), and the bulk-write
    // path operates on metadata. Excluding it avoids corrupting titles.
    return !isComputedType(type) && type !== 'files' && type !== 'title';
}

/**
 * Serializes a cell's value to plain text for the clipboard (TSV).
 * Arrays (multi_select/relation) and authors are resolved to readable titles.
 */
export function serializeCellForClipboard(value, type, idToTitle = {}) {
    if (value === undefined || value === null) return '';

    if (type === 'period') {
        const period = parsePeriod(value);
        return period.end ? `${period.start}/${period.end}` : period.start;
    }

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
 * Parses clipboard text into a 2D matrix (rows × columns).
 * Rows separated by line breaks, columns by tabs (Excel/TSV format).
 * Removes a single trailing empty row (typical of spreadsheet copy-paste).
 */
export function parseClipboardMatrix(text) {
    if (typeof text !== 'string' || text === '') return [];
    let rows = text.split(/\r\n|\n|\r/);
    if (rows.length > 1 && rows[rows.length - 1] === '') rows = rows.slice(0, -1);
    return rows.map(line => line.split('\t'));
}

/** Matches a value (id or title) against an options catalog. Returns the id or null. */
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
 * Coerces a raw value (from an internal clipboard or external text) to the
 * target column's type. Returns `{ value }` with the value to save, or `{ skip: true }`
 * if it can't be coerced without corrupting the data (the cell is skipped on paste).
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
            // Decimal with a COMMA (ca/es locale): "0,5" → 0.5. Only the
            // unambiguous case (a single comma, optional sign, WITHOUT a thousands separator)
            // to avoid having to guess "1.234,56" (thousands+decimal) or "1,2,3".
            // Without this, pasting a number in local format was silently skipped.
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
            // Preserves the calendar date exactly as written (even if it comes from a
            // "YYYY-MM-DDT..." datetime): we do NOT go through toISOString() because the
            // conversion to UTC can shift the day (e.g. with a +02:00 offset).
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
            if (Number.isNaN(d.getTime())) return SKIP;
            // LOCAL components (like `case 'date'`): we do NOT go through toISOString(),
            // that converts to UTC and shifts the time (pasting "2024-07-15 09:00"
            // from a spreadsheet was saved as "...T07:00:00.000Z" with an offset
            // +02:00). We save the time as written, without a Z suffix.
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const hh = String(d.getHours()).padStart(2, '0');
            const mi = String(d.getMinutes()).padStart(2, '0');
            return { value: `${yyyy}-${mm}-${dd}T${hh}:${mi}:00` };
        }

        case 'period': {
            if (isEmptyRaw(raw)) return { value: '' };
            if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                return { value: serializePeriod(raw) };
            }
            const s = String(raw).trim();
            return /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?\/\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/.test(s)
                ? { value: s }
                : SKIP;
        }

        case 'autoria': {
            // Only from a structured internal source; plain text is ambiguous.
            return Array.isArray(raw) ? { value: raw } : SKIP;
        }

        // text, url, zotero and any unknown type → plain text.
        default:
            if (raw == null) return { value: '' };
            return { value: Array.isArray(raw) ? raw.join(', ') : String(raw) };
    }
}

/** Compares two cell values (scalars or flat arrays) to detect no-ops. */
export function sameCellValue(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((x, i) => x === b[i]);
    }
    if (
        a && b
        && typeof a === 'object'
        && typeof b === 'object'
        && !Array.isArray(a)
        && !Array.isArray(b)
    ) {
        return JSON.stringify(a) === JSON.stringify(b);
    }
    return false;
}

// ── Range geometry ────────────────────────────────────────────────────

/** Inclusive list of integers between a and b (in any order). */
export function rangeBetween(a, b) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const out = [];
    for (let i = lo; i <= hi; i++) out.push(i);
    return out;
}

/** Clamps an index to [0, len-1]. */
export function clampIndex(i, len) {
    if (len <= 0) return 0;
    return Math.max(0, Math.min(i, len - 1));
}

/**
 * Calculates the geometry of an Excel-style paste.
 *
 * @param {number} srcRows  source rows (>=1)
 * @param {number} srcCols  source columns (>=1)
 * @param {{r0,c0,r1,c1}} target  selected target rectangle (inclusive indices)
 * @param {number} maxRows  rows actually present in the table
 * @param {number} maxCols  grid columns
 * @returns {{r0,c0,r1,c1}} effective rectangle to write to (clipped to bounds)
 *
 * - Single-cell target → expands to the source size (down/right).
 * - Range target → the range is respected (the source repeats within it using modulo).
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
