/**
 * autoriaUtils.js — helpers purs del tipus de camp "autoria"
 * (llista ordenada d'autors `{nom, cognom1, cognom2}`).
 *
 * En un fitxer separat dels components (AutoriaField.jsx) perquè React Fast
 * Refresh només funciona si un mòdul exporta NOMÉS components.
 */

export const emptyAuthor = () => ({ nom: '', cognom1: '', cognom2: '' });

// Pill visible: "Nom Cognom1 Cognom2".
export const authorFullName = (a) => [a?.nom, a?.cognom1, a?.cognom2].map(s => (s || '').trim()).filter(Boolean).join(' ');

// Etiqueta "Cognom1 Cognom2, Nom" per a cerca i tooltip.
export const authorSortLabel = (a) => {
    const family = [a?.cognom1, a?.cognom2].map(s => (s || '').trim()).filter(Boolean).join(' ');
    const given = (a?.nom || '').trim();
    return [family, given].filter(Boolean).join(', ');
};

export const sameAuthor = (a, b) => a?.nom === b?.nom && a?.cognom1 === b?.cognom1 && a?.cognom2 === b?.cognom2;

// Autors únics a partir d'un conjunt de valors crus de cel·la (cadascun pot ser
// un array d'autors). Dedup per nom|cognom1|cognom2; ignora autors buits.
// Serveix per als suggeriments d'autocompletar.
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
