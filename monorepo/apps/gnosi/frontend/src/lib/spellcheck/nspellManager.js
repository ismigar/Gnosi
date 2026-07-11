import { SUPPORTED_LANGS } from './detectLang';

// Spell-checker manager based on Hunspell compiled to WebAssembly (hunspell-asm).
// Hunspell-WASM was chosen over nspell because the Catalan dictionary
// (~210k arrels, FLAG long) fa petar nspell («Too many properties to enumerate»);
// Hunspell handles it natively and fast (~200 ms). The WASM is embedded in the
// browser bundle → it works the same in dev, Electron, and static web.
//
// The Hunspell dictionaries (.aff/.dic) are served as static assets from
// /public/dictionaries and are loaded lazily. Everything lives on the client.

const PERSONAL_KEY = 'gnosi_spell_personal';

let factoryPromise = null;      // Promise<HunspellFactory> (WASM module, only once)
const cache = new Map();        // lang -> Promise<adapter|null>
const instances = new Map();    // lang -> adapter (ja resolt)

function getFactory() {
    // Dynamic import: the Hunspell WASM (~640 kB gzip) is only downloaded when the
    // the checker actually activates, not when the editor loads.
    //
    // We don't use the package's `loadModule`: its ESM entry does
    // `import * as runtime from './lib/node/hunspell'` on top of an Emscripten module
    // CJS; when bundled, the namespace isn't callable ("runtimeModule is not
    // a function»). We replicate the loader, importing the factory DIRECTLY from the
    // navegador i desembolcallant `.default`.
    if (!factoryPromise) {
        // We use the CJS build instead: it replicates the path that works in Node (the
        // internal `require`s get converted correctly, including nanoid, and the
        // the package's `browser` field remaps the node→browser runtime). The build
        // the package's ESM, however, breaks when it's bundled.
        factoryPromise = import('hunspell-asm/dist/cjs/index.js').then((m) => {
            const loadModule = m.loadModule || m.default?.loadModule || m.default;
            return loadModule();
        });
    }
    return factoryPromise;
}

/** Words added by the user ("Add to dictionary"), shared across languages. */
export function getPersonalWords() {
    try {
        const raw = localStorage.getItem(PERSONAL_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function savePersonalWords(words) {
    try {
        localStorage.setItem(PERSONAL_KEY, JSON.stringify([...new Set(words)]));
    } catch {
        /* quota full or private mode: not critical */
    }
}

/**
 * Adds a word to the personal dictionary and to all spell checkers already
 * loaded. Persists it to localStorage so it survives reloads.
 */
export function addPersonalWord(word) {
    const w = (word || '').trim();
    if (!w) return;
    const words = getPersonalWords();
    if (!words.includes(w)) {
        words.push(w);
        savePersonalWords(words);
    }
    for (const spell of instances.values()) {
        try { spell.add(w); } catch { /* noop */ }
    }
}

/** Wraps a Hunspell instance with the API the plugin expects (correct/suggest/add). */
function makeAdapter(hs) {
    return {
        correct: (w) => {
            try { return hs.spell(w); } catch { return true; }
        },
        suggest: (w) => {
            try { return hs.suggest(w) || []; } catch { return []; }
        },
        add: (w) => {
            try { hs.addWord(w); } catch { /* noop */ }
        },
    };
}

/**
 * Loads (or returns from cache) the spell checker for a language. Returns a promise
 * with an adapter { correct, suggest, add }, or `null` if the language isn't supported
 * or the load fails (never throws: the spell checker is an enhancement, it must not break
 * the editor).
 */
export function loadSpeller(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) return Promise.resolve(null);
    if (cache.has(lang)) return cache.get(lang);

    const base = import.meta.env.BASE_URL || '/';
    const promise = (async () => {
        try {
            const [factory, affBuf, dicBuf] = await Promise.all([
                getFactory(),
                fetch(`${base}dictionaries/${lang}.aff`).then((r) => {
                    if (!r.ok) throw new Error(`aff ${r.status}`);
                    return r.arrayBuffer();
                }),
                fetch(`${base}dictionaries/${lang}.dic`).then((r) => {
                    if (!r.ok) throw new Error(`dic ${r.status}`);
                    return r.arrayBuffer();
                }),
            ]);
            const affPath = factory.mountBuffer(new Uint8Array(affBuf), `${lang}.aff`);
            const dicPath = factory.mountBuffer(new Uint8Array(dicBuf), `${lang}.dic`);
            const hs = factory.create(affPath, dicPath);
            const adapter = makeAdapter(hs);
            for (const w of getPersonalWords()) adapter.add(w);
            instances.set(lang, adapter);
            return adapter;
        } catch (err) {
            cache.delete(lang); // allows retrying later
            console.warn(`[spellcheck] no s'ha pogut carregar el diccionari «${lang}»:`, err);
            return null;
        }
    })();

    cache.set(lang, promise);
    return promise;
}

/** Already-resolved instance (synchronous), or `null` if it hasn't loaded yet. */
export function getReadySpeller(lang) {
    return instances.get(lang) || null;
}
