import { SUPPORTED_LANGS } from './detectLang';

// Gestor de correctors basat en Hunspell compilat a WebAssembly (hunspell-asm).
// Es va triar Hunspell-WASM en lloc de nspell perquè el diccionari català
// (~210k arrels, FLAG long) fa petar nspell («Too many properties to enumerate»);
// Hunspell el gestiona nativament i ràpid (~200 ms). El WASM va incrustat al
// bundle del navegador → funciona igual en dev, Electron i web estàtica.
//
// Els diccionaris Hunspell (.aff/.dic) es serveixen com a assets estàtics des de
// /public/dictionaries i es carreguen de forma mandrosa. Tot viu al client.

const PERSONAL_KEY = 'gnosi_spell_personal';

let factoryPromise = null;      // Promise<HunspellFactory> (mòdul WASM, una sola vegada)
const cache = new Map();        // lang -> Promise<adapter|null>
const instances = new Map();    // lang -> adapter (ja resolt)

function getFactory() {
    // Import dinàmic: el WASM d'Hunspell (~640 kB gzip) només es baixa quan el
    // corrector s'activa realment, no al carregar l'editor.
    //
    // No usem el `loadModule` del paquet: la seva entrada ESM fa
    // `import * as runtime from './lib/node/hunspell'` sobre un mòdul Emscripten
    // CJS; en fer-ne bundle, el namespace no és cridable («runtimeModule is not
    // a function»). Repliquem el loader important DIRECTAMENT el factory del
    // navegador i desembolcallant `.default`.
    if (!factoryPromise) {
        // Fem servir el build CJS: replica el camí que funciona a Node (els
        // `require` interns es converteixen correctament, inclòs nanoid, i el
        // camp `browser` del paquet remapa el runtime node→navegador). El build
        // ESM del paquet, en canvi, es trenca en fer-ne bundle.
        factoryPromise = import('hunspell-asm/dist/cjs/index.js').then((m) => {
            const loadModule = m.loadModule || m.default?.loadModule || m.default;
            return loadModule();
        });
    }
    return factoryPromise;
}

/** Paraules afegides per l'usuari («Afegeix al diccionari»), compartides entre idiomes. */
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
        /* quota plena o mode privat: no és crític */
    }
}

/**
 * Afegeix una paraula al diccionari personal i a tots els correctors ja
 * carregats. Persisteix a localStorage perquè sobrevisqui a recàrregues.
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

/** Embolcalla una instància Hunspell amb l'API que espera el plugin (correct/suggest/add). */
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
 * Carrega (o retorna de la caché) el corrector d'un idioma. Retorna una promesa
 * amb un adapter { correct, suggest, add }, o `null` si l'idioma no està suportat
 * o falla la càrrega (mai llança: el corrector és una millora, no ha de trencar
 * l'editor).
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
            cache.delete(lang); // permet reintentar més tard
            console.warn(`[spellcheck] no s'ha pogut carregar el diccionari «${lang}»:`, err);
            return null;
        }
    })();

    cache.set(lang, promise);
    return promise;
}

/** Instància ja resolta (síncron), o `null` si encara no s'ha carregat. */
export function getReadySpeller(lang) {
    return instances.get(lang) || null;
}
