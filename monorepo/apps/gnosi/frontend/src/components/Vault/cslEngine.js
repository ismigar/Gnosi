/**
 * Citation Style Language (CSL) engine wrapper around `citeproc-js`.
 *
 * citeproc-js is the reference library for processing CSL in
 * JavaScript (MIT-licensed, maintained by Frank Bennett). Here
 * we wrap it with a high-level API that:
 *   - Loads CSL styles and locales from `/public/csl/{styles,locales}/`
 *     with an in-memory cache.
 *   - Maps a "Recursos page" from the Gnosi Vault to a CSL-JSON item.
 *   - Returns formatted text for an inline citation or a bibliography.
 *
 * CSL-JSON structure (subset we generate):
 *   {
 *     id: "smith2020",
 *     type: "article-journal" | "book" | "chapter" | ...,
 *     author: [{ family: "Smith", given: "A." }],
 *     issued: { "date-parts": [[2020]] },
 *     title: "...",
 *     "container-title": "...",  // journal or host book
 *     publisher: "...",
 *     "publisher-place": "...",
 *     volume: "...", issue: "...", page: "...",
 *     DOI: "...", ISBN: "...", ISSN: "...", URL: "...",
 *   }
 *
 * See https://docs.citationstyles.org/ for the complete spec.
 */
import CSL from 'citeproc';
import { ZOTERO_TO_CSL_TYPE, LABEL_TO_ZOTERO_TYPE } from './zoteroSchema';

/**
 * Resolves the Vault's "Item Type" field (canonical Zotero key or
 * translated label) to a CSL type. Resolution order:
 *   1. Canonical Zotero key (`journalArticle`, `book`, `preprint`, …)
 *   2. Label translated in any locale (`"Article de revista acadèmica"` → ca-AD → journalArticle)
 *   3. Fallback `'document'` (generic CSL)
 *
 * This helper replaces the old hardcoded `ITEM_TYPE_MAP`. The
 * knowledge now lives in `zoteroSchema.js` (generated from the official schema).
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

// Canonical styles — static fallback if the backend doesn't respond or if we want to
// start up before the dynamic list arrives. They're completed with what
// detecti `GET /api/vault/csl/styles` (vegis `fetchAvailableStyles`).
export const AVAILABLE_STYLES = [
    { id: 'apa', label: 'APA 7th edition', file: 'apa.csl', locale: 'en-US' },
    { id: 'chicago-author-date', label: 'Chicago Author-Date', file: 'chicago-author-date.csl', locale: 'en-US' },
    { id: 'modern-language-association', label: 'MLA 9th edition', file: 'modern-language-association.csl', locale: 'en-US' },
    { id: 'ieee', label: 'IEEE', file: 'ieee.csl', locale: 'en-US' },
];

// Cache for styles discovered via the backend. It gets populated on the first
// `fetchAvailableStyles()` and is invalidated when the user uploads a new file.
let _dynamicStylesCache = null;

/**
 * Requests the full list of CSL styles in the catalog from the backend
 * (`frontend/public/csl/styles/`). If the call fails, it falls back to the
 * static `AVAILABLE_STYLES` list to avoid breaking the UX.
 *
 * Returned format: `[{id, file, label, locale}]` for consistency with the
 * static fallback. The backend sends `title` (official CSL name);
 * we map it to `label`. `locale` falls back to 'en-US' if unknown (CSL
 * can have `default-locale` but most styles don't include it;
 * in that case citeproc-js uses the globally configured locale).
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

/** Invalidates the cache (call after a successful upload). */
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
    // CSL.Engine requests locales synchronously via `retrieveLocale`.
    // That's why we preload them and store them in the cache before creating the engine.
    if (_localeCache.has(lang)) return _localeCache.get(lang);
    const xml = await fetchText(`/csl/locales/locales-${lang}.xml`);
    _localeCache.set(lang, xml);
    return xml;
}

/**
 * Creates (or reuses) a CSL Engine for a specific style and locale.
 * `items` is a map `id → CSL-JSON item` that the engine queries via
 * `retrieveItem`. It must be passed so the ids are known.
 */
export async function getEngine(styleId, locale, items) {
    const style = AVAILABLE_STYLES.find(s => s.id === styleId) || AVAILABLE_STYLES[0];
    const styleXml = await loadStyle(style.file);
    // Preloads the locales that the style and the user might need.
    // We always specify `en-US` as a fallback (most CSL styles
    // they use it for strings that have no translation in the requested locale).
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
        // Reused engine — the `sys.retrieveItem` needs to be updated so that
        // it has the most recent items. citeproc-js has a `sys` property
        // that's mutable, but recreating an engine is safe (the XML caches are kept).
        engine.sys.retrieveItem = (id) => items[id] || null;
    }
    return engine;
}

/**
 * Maps a page from the Vault Recursos to a CSL-JSON object.
 *
 * Heuristics and decisions:
 *  - `Citation Key` is the `id`. Without it, we return null (it can't be cited).
 *  - `Authors` is a free-form string ("Smith, A.; Jones, B." or "Lynn Margulis,
 *    Lorraine Olendzenski"). We try two formats:
 *      a) Separated by `;` → each part is an author (Surname, Name)
 *      b) Separated by `,` → first is Surname, Name (a single author)
 *  - `Item Type` (Llibre, Article de revista acadèmica, …) → CSL type
 *    (book, article-journal, …) via partial mapping. If nothing matches,
 *    falls back to "document" (generic).
 *  - `Llibre/Revista` is `container-title` for articles; for books it's
 *    irrelevant but we fill it in as a defensive safeguard.
 */
// Legacy synonyms and aliases that the official schema doesn't cover but that may
// exist in the frontmatter of old pages. They are resolved before the schema.
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
    // Detect separator. If it contains `;`, that's the separator between authors.
    // If only `,`, it's dangerous: it could be "Smith, A." (one author) or
    // "Lynn Margulis, Lorraine Olendzenski" (two authors). Heuristic:
    // if each segment has a single word, they are separate surnames. If each
    // segment has the format "Surname, Initial.", the `,` is not a separator.
    const parts = authorsStr.includes(';')
        ? authorsStr.split(';').map(s => s.trim()).filter(Boolean)
        : [authorsStr.trim()];
    const out = [];
    for (const p of parts) {
        // Format "Surname, Name" with comma + space → one author
        // Format "Name1 Surname1, Name2 Surname2" → two authors separated by a comma
        if (/,\s/.test(p) && p.split(',').length === 2) {
            const [family, given] = p.split(',').map(s => s.trim());
            if (family) out.push({ family, given });
        } else if (p.includes(',')) {
            // Multiple authors separated by comma
            for (const sub of p.split(',').map(s => s.trim()).filter(Boolean)) {
                const tokens = sub.split(/\s+/);
                if (tokens.length === 1) {
                    out.push({ family: tokens[0] });
                } else {
                    out.push({ family: tokens[tokens.length - 1], given: tokens.slice(0, -1).join(' ') });
                }
            }
        } else {
            // A single author without a comma
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
 * Detects an "autoria" field value (array of objects {nom,cognom1,cognom2})
 * within the metadata. Independent of the column name —which is cosmetic and
 * renamable—: we locate it by **shape of the value**, not by key. Returns
 * the array of structured authors or null if there is none.
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
 * Maps structured authors to the CSL-JSON `author` array.
 * CSL has no concept of a second surname: cognom1+cognom2 are merged into `family`.
 * An author with only `nom` (no surnames) is treated as a literal name.
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
    // Legacy aliases first (synonyms that the official schema doesn't cover),
    // then the resolver based on the generated schema.
    const type = LEGACY_TYPE_ALIASES[typeRaw] || resolveCslType(typeRaw);

    const item = {
        id,
        type,
        title: page.title || m['Title'] || '',
    };

    // Priority to the structured "autoria" field (deterministic citations); if not,
    // fallback to the legacy free-form string via heuristic.
    const structured = findStructuredAuthors(m);
    const authors = structured ? structuredAuthorsToCsl(structured) : parseAuthors(m['Authors']);
    if (authors.length) item.author = authors;

    // Citation year. If it contains an integer (e.g. "2020", "2020-05", "c. 2020",
    // "2020?"), we extract the year → `date-parts` (keeps the ordering, #568). If
    // it has NO digits but there is text ("en premsa", "in press"), we preserve it
    // as CSL `literal` so citeproc displays it as-is instead of "n.d."
    // (#584). Empty → we omit `issued` and it shows "n.d.".
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
 * Renders the inline citation of a single item with a specific style.
 * Returns the already-formatted text (e.g. "(Turkle, 2011)").
 */
export async function renderInlineCitation(citationKey, items, styleId = 'apa', locale = 'en-US') {
    if (!items[citationKey]) return `[?@${citationKey}]`;
    const engine = await getEngine(styleId, locale, items);
    engine.updateItems([citationKey]);
    // citeproc-js returns [[noteIndex, html, citationID]] for processCitationCluster
    const citationData = {
        properties: { noteIndex: 0 },
        citationItems: [{ id: citationKey }],
    };
    try {
        const result = engine.processCitationCluster(citationData, [], []);
        // result format: [statusInfo, [[clusterIndex, html, clusterID], ...]]
        const clusters = result[1];
        if (clusters && clusters[0]) {
            // Third is the formatted HTML
            return clusters[0][1] || `(${citationKey})`;
        }
    } catch (err) {
        console.warn('citeproc render error', err);
    }
    return `(${citationKey})`;
}

/**
 * Generates the HTML bibliography for a set of items.
 * Returns { entries, formatting } or null if there are no items.
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
