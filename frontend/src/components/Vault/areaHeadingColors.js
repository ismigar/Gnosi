/* -------------------------------------------------------------------------- */
/*  Colors de fons de les capçaleres de seccions de les pàgines d'ÀREA          */
/* -------------------------------------------------------------------------- */
/**
 * A les pàgines de la taula "Àrees", cada secció (capçalera h1…hn) ha de portar
 * un color de fons fix segons el seu títol, perquè totes les àrees comparteixen
 * la mateixa estructura (Formació, Competències, Recursos, …). Això NO toca el
 * contingut de la nota: és un tintat purament visual que BlockEditor aplica al
 * DOM segons el text de cada capçalera. Així val per a totes les àrees, actuals
 * i futures, sense migrar res.
 *
 * Els colors casen amb la paleta de BlockNote (blue/pink/brown/green/red/
 * yellow/gray/purple/orange), definits a `index.css` via `[data-area-heading]`.
 */

/**
 * Normalitza un títol de capçalera per comparar-lo: treu wikilinks `[[…]]`,
 * accents, puntuació i passa a minúscules. Tolera l'ortografia (català/castellà)
 * i la variant amb enllaç ("Com contribueixen a [[El meu telos…]]:").
 */
export function normalizeHeadingText(raw) {
    return String(raw || '')
        // [[target|alias]] → alias ; [[target]] → target
        .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
        .normalize('NFD').replace(/[̀-ͯ]/g, '') // treu accents
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ') // treu puntuació (`:`, etc.)
        .replace(/\s+/g, ' ')
        .trim();
}

// Regles ordenades: la primera el prefix normalitzat del títol que casa, guanya.
// Es comprova per prefix (startsWith) perquè alguns títols porten cua variable
// (p.ex. "com contribueixen a el meu telos i vocacio personal").
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
 * Retorna la clau de color ('blue'|'pink'|…) per a un títol de capçalera, o
 * `null` si no casa amb cap secció coneguda.
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
