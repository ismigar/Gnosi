/**
 * autoriaUtils.js — pure helpers for the "autoria" field type
 * (ordered list of authors `{nom, cognom1, cognom2}`).
 *
 * In a file separate from the components (AutoriaField.jsx) because React Fast
 * Refresh only works if a module exports ONLY components.
 */

export const emptyAuthor = () => ({ nom: '', cognom1: '', cognom2: '' });

// Pill visible: "Nom Cognom1 Cognom2".
export const authorFullName = (a) => [a?.nom, a?.cognom1, a?.cognom2].map(s => (s || '').trim()).filter(Boolean).join(' ');

// Label "Surname1 Surname2, Name" for search and tooltip.
export const authorSortLabel = (a) => {
    const family = [a?.cognom1, a?.cognom2].map(s => (s || '').trim()).filter(Boolean).join(' ');
    const given = (a?.nom || '').trim();
    return [family, given].filter(Boolean).join(', ');
};

export const sameAuthor = (a, b) => a?.nom === b?.nom && a?.cognom1 === b?.cognom1 && a?.cognom2 === b?.cognom2;

// Unique authors from a set of raw cell values (each one can be
// an array of authors). Dedup by name|surname1|surname2; ignore empty authors.
// Used for autocomplete suggestions.
export const dedupeAuthors = (values) => {
    const seen = new Set();
    const out = [];
    for (const v of values || []) {
        if (!Array.isArray(v)) continue;
        for (const a of v) {
            if (!a || typeof a !== 'object') continue;
            const key = `${a.nom || ''}|${a.cognom1 || ''}|${a.cognom2 || ''}`;
            if (key === '||' || seen.has(key)) continue;
            seen.add(key);
            out.push({ nom: a.nom || '', cognom1: a.cognom1 || '', cognom2: a.cognom2 || '' });
        }
    }
    return out;
};
