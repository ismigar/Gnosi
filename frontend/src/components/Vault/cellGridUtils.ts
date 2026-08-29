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
import {
    parsePeriod,
    serializePeriod,
} from '../../utils/projectPlanning';


export type CellTitleIndex = Readonly<Record<string, string>>;


export interface RelatedCellNote {
    readonly id: string;
    readonly title?: unknown;
}


export interface FieldCoercionContext {
    readonly idToTitle?: CellTitleIndex;
    readonly options?: readonly string[];
    readonly relatedNotes?: readonly RelatedCellNote[];
}


export interface PasteRectangle {
    readonly c0: number;
    readonly c1: number;
    readonly r0: number;
    readonly r1: number;
}


export type FieldCoercionResult =
    | { readonly skip: true; readonly value?: never }
    | { readonly skip?: false; readonly value: unknown };


function cellText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (
        typeof value === 'boolean'
        || typeof value === 'bigint'
        || typeof value === 'number'
    ) return String(value);
    if (typeof value === 'symbol') return value.description ?? '';
    if (typeof value === 'function') return value.name;
    try {
        return JSON.stringify(value) || '';
    } catch {
        return '';
    }
}

/** Computed or action types: never edited or pasted. */
export function isComputedType(type: string): boolean {
    return type === 'formula' || type === 'rollup' || type === 'virtual' || type === 'button'
        || type === 'created_time' || type === 'last_edited_time';
}

/** True if a cell of this type can receive a paste. */
export function isPasteableType(type: string): boolean {
    // The `title` is navigable and editable cell by cell, but it's NOT pasted or
    // cleared in bulk: it lives in `note.title` (not in `metadata`), and the bulk-write
    // path operates on metadata. Excluding it avoids corrupting titles.
    return !isComputedType(type) && type !== 'files' && type !== 'title';
}

/**
 * Serializes a cell's value to plain text for the clipboard (TSV).
 * Arrays (multi_select/relation) and authors are resolved to readable titles.
 */
export function serializeCellForClipboard(
    value: unknown,
    type: string,
    idToTitle: CellTitleIndex = {},
): string {
    if (value === undefined || value === null) return '';

    if (type === 'period') {
        const period = parsePeriod(value);
        return period.end ? `${period.start}/${period.end}` : period.start;
    }

    if (type === 'autoria' && Array.isArray(value)) {
        return value
            .map((author) => {
                if (typeof author !== 'object' || author === null) return '';
                const record = author as Readonly<Record<string, unknown>>;
                return [record.nom, record.cognom1, record.cognom2]
                    .filter(Boolean)
                    .map(cellText)
                    .join(' ')
                    .trim();
            })
            .filter(Boolean)
            .join('; ');
    }

    if (Array.isArray(value)) {
        return value.map((item) => {
            const key = cellText(item);
            return idToTitle[key] ?? cellText(item);
        }).filter(Boolean).join(', ');
    }

    if (typeof value === 'boolean') return value ? 'true' : 'false';

    const key = cellText(value);
    return idToTitle[key] ?? key;
}

/**
 * Parses clipboard text into a 2D matrix (rows × columns).
 * Rows separated by line breaks, columns by tabs (Excel/TSV format).
 * Removes a single trailing empty row (typical of spreadsheet copy-paste).
 */
export function parseClipboardMatrix(text: unknown): string[][] {
    if (typeof text !== 'string' || text === '') return [];
    let rows = text.split(/\r\n|\n|\r/);
    if (rows.length > 1 && rows[rows.length - 1] === '') rows = rows.slice(0, -1);
    return rows.map(line => line.split('\t'));
}

/** Matches a value (id or title) against an options catalog. Returns the id or null. */
function matchOption(
    raw: unknown,
    options: readonly string[] = [],
    idToTitle: CellTitleIndex = {},
): string | null {
    const s = cellText(raw).trim();
    if (s === '') return null;
    if (options.includes(s)) return s;
    const lower = s.toLowerCase();
    for (const opt of options) {
        if ((idToTitle[opt] ?? opt).trim().toLowerCase() === lower) return opt;
    }
    return null;
}

function isEmptyRaw(raw: unknown): boolean {
    return (
        raw === undefined ||
        raw === null ||
        (typeof raw === 'string' && raw.trim() === '') ||
        (Array.isArray(raw) && raw.length === 0)
    );
}

const SKIP: FieldCoercionResult = Object.freeze({ skip: true });

/**
 * Coerces a raw value (from an internal clipboard or external text) to the
 * target column's type. Returns `{ value }` with the value to save, or `{ skip: true }`
 * if it can't be coerced without corrupting the data (the cell is skipped on paste).
 *
 * ctx: { options?: string[], idToTitle?: Record, relatedNotes?: {id,title}[] }
 */
export function coerceValueForField(
    raw: unknown,
    type: string,
    ctx: FieldCoercionContext = {},
): FieldCoercionResult {
    const { options = [], idToTitle = {}, relatedNotes = [] } = ctx;

    if (isComputedType(type) || type === 'files' || type === 'title') return SKIP;

    switch (type) {
        case 'number': {
            if (isEmptyRaw(raw)) return { value: '' };
            let parsedNumber = typeof raw === 'number'
                ? raw
                : Number(cellText(raw).trim());
            // Decimal with a COMMA (ca/es locale): "0,5" → 0.5. Only the
            // unambiguous case (a single comma, optional sign, WITHOUT a thousands separator)
            // to avoid having to guess "1.234,56" (thousands+decimal) or "1,2,3".
            // Without this, pasting a number in local format was silently skipped.
            if (typeof raw === 'string' && !Number.isFinite(parsedNumber)) {
                const s = raw.trim();
                if (/^-?\d+,\d+$/u.test(s)) {
                    parsedNumber = Number(s.replace(',', '.'));
                }
            }
            return Number.isFinite(parsedNumber)
                ? { value: parsedNumber }
                : SKIP;
        }

        case 'checkbox': {
            if (typeof raw === 'boolean') return { value: raw };
            if (isEmptyRaw(raw)) return { value: false };
            const s = cellText(raw).trim().toLowerCase();
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
                ? raw.map(cellText)
                : cellText(raw).split(',').map((item) => item.trim()).filter(Boolean);
            if (arr.length === 0) return { value: [] };
            const matched = arr
                .map((item) => matchOption(item, options, idToTitle))
                .filter((item): item is string => item !== null);
            return matched.length > 0 ? { value: Array.from(new Set(matched)) } : SKIP;
        }

        case 'relation': {
            const arr = Array.isArray(raw)
                ? raw.map(cellText)
                : cellText(raw).split(',').map((item) => item.trim()).filter(Boolean);
            if (arr.length === 0) return { value: [] };
            const ids = new Set(relatedNotes.map((note) => note.id));
            const titleToId: Record<string, string> = {};
            for (const note of relatedNotes) {
                const normalizedTitle = cellText(
                    note.title ?? idToTitle[note.id] ?? note.id,
                ).trim().toLowerCase();
                titleToId[normalizedTitle] = note.id;
            }
            const matched = arr
                .map((item) => {
                    const s = item.trim();
                    if (ids.has(s)) return s;
                    return titleToId[s.toLowerCase()] || null;
                })
                .filter((item): item is string => item !== null);
            return matched.length > 0 ? { value: Array.from(new Set(matched)) } : SKIP;
        }

        case 'date': {
            if (isEmptyRaw(raw)) return { value: '' };
            const s = cellText(raw).trim();
            // Preserves the calendar date exactly as written (even if it comes from a
            // "YYYY-MM-DDT..." datetime): we do NOT go through toISOString() because the
            // conversion to UTC can shift the day (e.g. with a +02:00 offset).
            const isoDate = s.match(/^(\d{4}-\d{2}-\d{2})/u)?.[1];
            if (isoDate) return { value: isoDate };
            const d = new Date(s);
            if (Number.isNaN(d.getTime())) return SKIP;
            const yyyy = String(d.getFullYear());
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return { value: `${yyyy}-${mm}-${dd}` };
        }

        case 'datetime': {
            if (isEmptyRaw(raw)) return { value: '' };
            const s = cellText(raw).trim();
            if (s.includes('T') && !Number.isNaN(new Date(s).getTime())) return { value: s };
            const d = new Date(s);
            if (Number.isNaN(d.getTime())) return SKIP;
            // LOCAL components (like `case 'date'`): we do NOT go through toISOString(),
            // that converts to UTC and shifts the time (pasting "2024-07-15 09:00"
            // from a spreadsheet was saved as "...T07:00:00.000Z" with an offset
            // +02:00). We save the time as written, without a Z suffix.
            const yyyy = String(d.getFullYear());
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
            const s = cellText(raw).trim();
            return /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?\/\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/u.test(s)
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
            return {
                value: Array.isArray(raw)
                    ? raw.map(cellText).join(', ')
                    : cellText(raw),
            };
    }
}

/** Compares two cell values (scalars or flat arrays) to detect no-ops. */
export function sameCellValue(a: unknown, b: unknown): boolean {
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
export function rangeBetween(a: number, b: number): number[] {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const out: number[] = [];
    for (let index = lo; index <= hi; index += 1) out.push(index);
    return out;
}

/** Clamps an index to [0, len-1]. */
export function clampIndex(index: number, length: number): number {
    if (length <= 0) return 0;
    return Math.max(0, Math.min(index, length - 1));
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
export function computePasteRect(
    srcRows: number,
    srcCols: number,
    target: PasteRectangle,
    maxRows: number,
    maxCols: number,
): PasteRectangle {
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
