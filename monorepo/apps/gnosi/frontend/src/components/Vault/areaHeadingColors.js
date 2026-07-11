/* -------------------------------------------------------------------------- */
/*  Background colors of section headers on AREA pages          */
/* -------------------------------------------------------------------------- */
/**
 * On pages of the "Àrees" table, each section (h1…hn heading) must carry
 * a fixed background color based on its title, because all areas share
 * the same structure (Formació, Competències, Recursos, …). This does NOT touch the
 * note's content: it's a purely visual tint that BlockEditor applies to the
 * DOM based on the text of each heading. This way it works for all areas, current
 * and future, without migrating anything.
 *
 * The colors match BlockNote's palette (blue/pink/brown/green/red/
 * yellow/gray/purple/orange), defined in `index.css` via `[data-area-heading]`.
 */

/**
 * Normalizes a heading title for comparison: strips wikilinks `[[…]]`,
 * accents, punctuation, and lowercases it. Tolerates spelling (Catalan/Spanish)
 * and the linked variant ("How do they contribute to [[My telos…]]:").
 */
export function normalizeHeadingText(raw) {
    return String(raw || '')
        // [[target|alias]] → alias ; [[target]] → target
        .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
        .normalize('NFD').replace(/[̀-ͯ]/g, '') // removes accents
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ') // strips punctuation (`:`, etc.)
        .replace(/\s+/g, ' ')
        .trim();
}

// Ordered rules: the first one whose normalized title prefix matches wins.
// Checked by prefix (startsWith) because some titles carry a variable tail
// (e.g. "how do they contribute to my telos and personal vocation").
const RULES = [
    { key: 'blue', prefixes: ['formacio', 'formacion'] },
    { key: 'pink', prefixes: ['experiencia prof', 'experiencia profe'] },
    { key: 'brown', prefixes: ['competencies', 'competencias'] },
    { key: 'green', prefixes: ['desenvolupades', 'desenvolupada', 'desarrolladas'] },
    { key: 'red', prefixes: ['a desenvolupar', 'a desarrollar'] },
    { key: 'yellow', prefixes: ['com contribueixen'] },
    { key: 'gray', prefixes: ['recursos'] },
    { key: 'purple', prefixes: ['projectes', 'proyectos'] },
    { key: 'orange', prefixes: ['notes i extractes', 'notes i estractes'] },
];

/**
 * Returns the color key ('blue'|'pink'|…) for a heading title, or
 * `null` if it doesn't match any known section.
 */
export function areaHeadingColorKey(rawText) {
    const norm = normalizeHeadingText(rawText);
    if (!norm) return null;
    for (const rule of RULES) {
        if (rule.prefixes.some((p) => norm.startsWith(p))) return rule.key;
    }
    return null;
}

export default areaHeadingColorKey;
