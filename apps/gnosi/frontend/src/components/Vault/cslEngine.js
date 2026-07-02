/**
 * Citation Style Language (CSL) engine wrapper sobre `citeproc-js`.
 *
 * citeproc-js és la biblioteca de referència per a processar CSL en
 * JavaScript (MIT-licensed, mantinguda per Frank Bennett). Aquí
 * l'embolcallem amb una API d'alt nivell que:
 *   - Carrega estils CSL i locales des de `/public/csl/{styles,locales}/`
 *     amb cache en memòria.
 *   - Mapeja una "Recursos page" del Vault Gnosi a un item CSL-JSON.
 *   - Retorna text formatat per a una cita inline o una bibliografia.
 *
 * Estructura CSL-JSON (subset que generem):
 *   {
 *     id: "smith2020",
 *     type: "article-journal" | "book" | "chapter" | ...,
 *     author: [{ family: "Smith", given: "A." }],
 *     issued: { "date-parts": [[2020]] },
 *     title: "...",
 *     "container-title": "...",  // revista o llibre antifitrió
 *     publisher: "...",
 *     "publisher-place": "...",
 *     volume: "...", issue: "...", page: "...",
 *     DOI: "...", ISBN: "...", ISSN: "...", URL: "...",
 *   }
 *
 * Vegeu https://docs.citationstyles.org/ per a la spec completa.
 */
import CSL from 'citeproc';
import { ZOTERO_TO_CSL_TYPE, LABEL_TO_ZOTERO_TYPE } from './zoteroSchema';

/**
 * Resol el camp "Item Type" del Vault (clau Zotero canònica o label
 * traduït) a un tipus CSL. Ordre de resolució:
 *   1. Clau Zotero canònica (`journalArticle`, `book`, `preprint`, …)
 *   2. Label traduït a qualsevol locale (`"Article de revista acadèmica"` → ca-AD → journalArticle)
 *   3. Fallback `'document'` (CSL genèric)
 *
 * Aquest helper substitueix l'antic `ITEM_TYPE_MAP` hardcoded. El
 * coneixement viu ara a `zoteroSchema.js` (generat des de l'oficial).
 */
export function resolveCslType(raw) {
    if (!raw || typeof raw !== 'string') return 'document';
    if (ZOTERO_TO_CSL_TYPE[raw]) return ZOTERO_TO_CSL_TYPE[raw];
    for (const loc of Object.keys(LABEL_TO_ZOTERO_TYPE)) {
        const zot = LABEL_TO_ZOTERO_TYPE[loc][raw];
        if (zot && ZOTERO_TO_CSL_TYPE[zot]) return ZOTERO_TO_CSL_TYPE[zot];
    }
    return 'document';
}

// Estils canònics — fallback estàtic si el backend no respon o si volem
// arrencar abans que la llista dinàmica arribi. Es completen amb el que
// detecti `GET /api/vault/csl/styles` (vegis `fetchAvailableStyles`).
export const AVAILABLE_STYLES = [
    { id: 'apa', label: 'APA 7th edition', file: 'apa.csl', locale: 'en-US' },
    { id: 'chicago-author-date', label: 'Chicago Author-Date', file: 'chicago-author-date.csl', locale: 'en-US' },
    { id: 'modern-language-association', label: 'MLA 9th edition', file: 'modern-language-association.csl', locale: 'en-US' },
    { id: 'ieee', label: 'IEEE', file: 'ieee.csl', locale: 'en-US' },
];

// Cache per als estils descoberts via backend. Es popula al primer
// `fetchAvailableStyles()` i s'invalida quan l'usuari puja un nou fitxer.
let _dynamicStylesCache = null;

/**
 * Demana al backend la llista completa d'estils CSL al catàleg
 * (`frontend/public/csl/styles/`). Si la crida falla, cau a la llista
 * estàtica `AVAILABLE_STYLES` per no trencar la UX.
 *
 * Format retornat: `[{id, file, label, locale}]` per coherència amb el
 * fallback estàtic. El backend envia `title` (denominació oficial CSL);
 * el mappem a `label`. `locale` cau a 'en-US' si no es coneix (el CSL
 * pot tenir `default-locale` però la majoria d'estils no el porten;
 * en aquest cas citeproc-js usa el locale globalment configurat).
 */
export async function fetchAvailableStyles({ force = false } = {}) {
    if (_dynamicStylesCache && !force) return _dynamicStylesCache;
    try {
        const r = await fetch('/api/vault/csl/styles');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        const styles = (data?.styles || []).map((s) => ({
            id: s.id,
            file: s.file,
            label: s.title || s.id,
            locale: 'en-US',
        }));
        if (styles.length > 0) {
            _dynamicStylesCache = styles;
            return styles;
        }
    } catch (err) {
        console.warn('fetchAvailableStyles fallback to static list:', err?.message);
    }
    _dynamicStylesCache = AVAILABLE_STYLES;
    return AVAILABLE_STYLES;
}

/** Invalida el cache (cridar després d'un upload reeixit). */
export function invalidateAvailableStylesCache() {
    _dynamicStylesCache = null;
}

// Locales disponibles
export const AVAILABLE_LOCALES = ['ca-AD', 'es-ES', 'en-US', 'en-GB'];

// --- Caches ---
const _styleCache = new Map();   // styleFile → XML string
const _localeCache = new Map();  // langCode → XML string
const _engineCache = new Map();  // `${styleId}|${locale}` → CSL.Engine (lazy)

async function fetchText(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.text();
}

async function loadStyle(file) {
    if (_styleCache.has(file)) return _styleCache.get(file);
    const xml = await fetchText(`/csl/styles/${file}`);
    _styleCache.set(file, xml);
    return xml;
}

async function loadLocale(lang) {
    // CSL.Engine demana els locales síncronament via `retrieveLocale`.
    // Per això els pre-loadem i els guardem al cache abans de crear l'engine.
    if (_localeCache.has(lang)) return _localeCache.get(lang);
    const xml = await fetchText(`/csl/locales/locales-${lang}.xml`);
    _localeCache.set(lang, xml);
    return xml;
}

/**
 * Crea (o reusa) un CSL Engine per a un estil i locale concrets.
 * `items` és un mapa `id → CSL-JSON item` que l'engine consulta via
 * `retrieveItem`. Cal passar-lo perquè els ids siguin coneguts.
 */
export async function getEngine(styleId, locale, items) {
    const style = AVAILABLE_STYLES.find(s => s.id === styleId) || AVAILABLE_STYLES[0];
    const styleXml = await loadStyle(style.file);
    // Pre-carrega els locales que el style i el user poden necessitar.
    // Especifiquem `en-US` sempre com a fallback (la majoria de CSL styles
    // l'usen per a strings que no tenen traducció al locale demanat).
    const wantedLocales = new Set([locale, 'en-US']);
    await Promise.all([...wantedLocales].map(loadLocale));

    const cacheKey = `${style.id}|${locale}`;
    let engine = _engineCache.get(cacheKey);
    if (!engine) {
        const sys = {
            retrieveLocale: (lang) => _localeCache.get(lang) || _localeCache.get('en-US') || '',
            retrieveItem: (id) => items[id] || null,
        };
        engine = new CSL.Engine(sys, styleXml, locale);
        _engineCache.set(cacheKey, engine);
    } else {
        // Engine reutilitzat — cal actualitzar el `sys.retrieveItem` perquè
        // tingui els items més recents. citeproc-js té una propietat `sys`
        // mutable, però refer un engine és segur (els caches XML es mantenen).
        engine.sys.retrieveItem = (id) => items[id] || null;
    }
    return engine;
}

/**
 * Mapeja una pàgina del Vault Recursos a un objecte CSL-JSON.
 *
 * Heurístiques i decisions:
 *  - `Citation Key` és l'`id`. Sense ell, retornem null (no es pot citar).
 *  - `Authors` és un string lliure ("Smith, A.; Jones, B." o "Lynn Margulis,
 *    Lorraine Olendzenski"). Provem dos formats:
 *      a) Separat per `;` → cada part és un autor (Cognom, Nom)
 *      b) Separat per `,` → primer és Cognom, Nom (un sol autor)
 *  - `Item Type` (Llibre, Article de revista acadèmica, …) → CSL type
 *    (book, article-journal, …) via mapeig parcial. Si no coincideix,
 *    cau a "document" (genèric).
 *  - `Llibre/Revista` és `container-title` per articles; per llibres és
 *    irrelevant però l'omplim com a aïllament defensiu.
 */
// Sinònims i alies legacy que el schema oficial no cobreix però que poden
// existir al frontmatter de pàgines antigues. Es resolen abans del schema.
const LEGACY_TYPE_ALIASES = {
    'Article científic': 'article-journal',
    'Article de revista': 'article-journal',
    'Article divulgatiu': 'article-magazine',
    'Tesis': 'thesis',
    'Manual': 'book',
    'Ponència': 'paper-conference',
    'Curs': 'document',
    'Relat': 'document',
    'Document': 'document',
    'Vídeo': 'motion_picture',
    'Entrevista/testimoni': 'interview',
};

function parseAuthors(authorsStr) {
    if (!authorsStr || typeof authorsStr !== 'string') return [];
    // Detectar separador. Si conté `;`, és el separador entre autors.
    // Si només `,`, és perillós: pot ser "Smith, A." (un autor) o
    // "Lynn Margulis, Lorraine Olendzenski" (dos autors). Heurística:
    // si cada segment té un sol mot, són cognoms separats. Si cada
    // segment té format "Cognom, Inicial.", el `,` no és separador.
    const parts = authorsStr.includes(';')
        ? authorsStr.split(';').map(s => s.trim()).filter(Boolean)
        : [authorsStr.trim()];
    const out = [];
    for (const p of parts) {
        // Format "Cognom, Nom" amb coma + espai → un autor
        // Format "Nom1 Cognom1, Nom2 Cognom2" → dos autors separats per coma
        if (/,\s/.test(p) && p.split(',').length === 2) {
            const [family, given] = p.split(',').map(s => s.trim());
            if (family) out.push({ family, given });
        } else if (p.includes(',')) {
            // Múltiples autors separats per coma
            for (const sub of p.split(',').map(s => s.trim()).filter(Boolean)) {
                const tokens = sub.split(/\s+/);
                if (tokens.length === 1) {
                    out.push({ family: tokens[0] });
                } else {
                    out.push({ family: tokens[tokens.length - 1], given: tokens.slice(0, -1).join(' ') });
                }
            }
        } else {
            // Un sol autor sense coma
            const tokens = p.split(/\s+/);
            if (tokens.length === 1) {
                out.push({ family: tokens[0] });
            } else {
                out.push({ family: tokens[tokens.length - 1], given: tokens.slice(0, -1).join(' ') });
            }
        }
    }
    return out;
}

/**
 * Detecta un valor de camp "autoria" (array d'objectes {nom,cognom1,cognom2})
 * dins la metadata. Independent del nom de la columna —que és cosmètic i
 * renombrable—: el localitzem per **forma del valor**, no per clau. Retorna
 * l'array d'autors estructurats o null si no n'hi ha cap.
 */
function findStructuredAuthors(metadata) {
    if (!metadata || typeof metadata !== 'object') return null;
    for (const v of Object.values(metadata)) {
        if (Array.isArray(v) && v.some(a => a && typeof a === 'object' && ('cognom1' in a || 'cognom2' in a || 'nom' in a))) {
            return v;
        }
    }
    return null;
}

/**
 * Mapeja autors estructurats a l'array `author` de CSL-JSON.
 * CSL no té concepte de segon cognom: cognom1+cognom2 es fusionen a `family`.
 * Un autor amb només `nom` (sense cognoms) es tracta com a nom literal.
 */
function structuredAuthorsToCsl(list) {
    const out = [];
    for (const a of list) {
        if (!a || typeof a !== 'object') continue;
        const family = [a.cognom1, a.cognom2].map(s => (s || '').trim()).filter(Boolean).join(' ');
        const given = (a.nom || '').trim();
        if (!family && !given) continue;
        if (!family) { out.push({ literal: given }); continue; }
        const entry = { family };
        if (given) entry.given = given;
        out.push(entry);
    }
    return out;
}

export function recursosPageToCsl(page) {
    if (!page) return null;
    const m = page.metadata || {};
    const id = m['Citation Key'];
    if (!id) return null;

    const typeRaw = m['Item Type'] || '';
    // Legacy aliases primer (sinònims que el schema oficial no cobreix),
    // després el resolver basat en el schema generat.
    const type = LEGACY_TYPE_ALIASES[typeRaw] || resolveCslType(typeRaw);

    const item = {
        id,
        type,
        title: page.title || m['Title'] || '',
    };

    // Prioritat al camp "autoria" estructurat (citacions deterministes); si no
    // n'hi ha, fallback a l'string lliure legacy via heurística.
    const structured = findStructuredAuthors(m);
    const authors = structured ? structuredAuthorsToCsl(structured) : parseAuthors(m['Authors']);
    if (authors.length) item.author = authors;

    // Any de cita. Si conté un enter (p. ex. "2020", "2020-05", "c. 2020",
    // "2020?"), n'extraiem l'any → `date-parts` (manté l'ordenació, #568). Si
    // NO té cap dígit però hi ha text ("en premsa", "in press"), el preservem
    // com a `literal` CSL perquè citeproc el mostri tal qual en lloc de "n.d."
    // (#584). Buit → ometem `issued` i surt "n.d.".
    const yearRaw = String(m['Any'] ?? '').trim();
    const yearMatch = yearRaw.match(/-?\d{1,4}/);
    if (yearMatch) {
        item.issued = { 'date-parts': [[Number(yearMatch[0])]] };
    } else if (yearRaw) {
        item.issued = { literal: yearRaw };
    }

    if (m['Llibre/Revista']) item['container-title'] = m['Llibre/Revista'];
    if (m['Editorial']) item.publisher = m['Editorial'];
    if (m['Lloc']) item['publisher-place'] = m['Lloc'];
    if (m['Volum']) item.volume = String(m['Volum']);
    if (m['Número']) item.issue = String(m['Número']);
    if (m['Pàgines']) item.page = String(m['Pàgines']);
    if (m['Edició']) item.edition = String(m['Edició']);
    if (m['DOI']) item.DOI = m['DOI'];
    if (m['ISBN']) item.ISBN = m['ISBN'];
    if (m['ISSN']) item.ISSN = m['ISSN'];
    if (m['URL']) item.URL = m['URL'];
    if (m['Idioma']) item.language = m['Idioma'];

    return item;
}

/**
 * Renderitza la cita inline d'un sol item amb un estil concret.
 * Retorna el text ja formatat (p.ex. "(Turkle, 2011)").
 */
export async function renderInlineCitation(citationKey, items, styleId = 'apa', locale = 'en-US') {
    if (!items[citationKey]) return `[?@${citationKey}]`;
    const engine = await getEngine(styleId, locale, items);
    engine.updateItems([citationKey]);
    // citeproc-js retorna [[noteIndex, html, citationID]] per a processCitationCluster
    const citationData = {
        properties: { noteIndex: 0 },
        citationItems: [{ id: citationKey }],
    };
    try {
        const result = engine.processCitationCluster(citationData, [], []);
        // result format: [statusInfo, [[clusterIndex, html, clusterID], ...]]
        const clusters = result[1];
        if (clusters && clusters[0]) {
            // Tercer és el HTML formatat
            return clusters[0][1] || `(${citationKey})`;
        }
    } catch (err) {
        console.warn('citeproc render error', err);
    }
    return `(${citationKey})`;
}

/**
 * Genera la bibliografia HTML per a un conjunt d'items.
 * Retorna { entries, formatting } o null si no hi ha cap item.
 */
export async function renderBibliography(citationKeys, items, styleId = 'apa', locale = 'en-US') {
    if (!citationKeys?.length) return null;
    const engine = await getEngine(styleId, locale, items);
    engine.updateItems(citationKeys);
    try {
        const bib = engine.makeBibliography();
        if (!bib || !bib[1]) return null;
        return { entries: bib[1], formatting: bib[0] };
    } catch (err) {
        console.warn('citeproc bibliography error', err);
        return null;
    }
}
