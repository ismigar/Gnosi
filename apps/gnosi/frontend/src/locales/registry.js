export const FALLBACK_LOCALE = 'en';

const LOCALE_PATH_RE = /^\.\/([^/]+)\/translation\.json$/;

export function canonicalizeLocale(value) {
    const normalized = String(value || '').trim().replaceAll('_', '-');
    if (!normalized) return null;
    try {
        return Intl.getCanonicalLocales(normalized)[0] || null;
    } catch {
        return null;
    }
}

function readCatalogue(moduleValue) {
    const catalogue = moduleValue?.default || moduleValue;
    if (!catalogue || typeof catalogue !== 'object' || Array.isArray(catalogue)) {
        throw new Error('Locale catalogue must export a JSON object.');
    }
    return catalogue;
}

function validateMetadata(code, metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new Error(`Locale "${code}" is missing the required _meta object.`);
    }
    if (typeof metadata.nativeName !== 'string' || !metadata.nativeName.trim()) {
        throw new Error(`Locale "${code}" must define _meta.nativeName.`);
    }
    const intlLocale = canonicalizeLocale(metadata.intlLocale);
    if (!intlLocale) {
        throw new Error(`Locale "${code}" has an invalid _meta.intlLocale.`);
    }
    if (metadata.direction !== 'ltr' && metadata.direction !== 'rtl') {
        throw new Error(`Locale "${code}" must define _meta.direction as "ltr" or "rtl".`);
    }
    const zoteroLocale = metadata.zoteroLocale == null
        ? null
        : canonicalizeLocale(metadata.zoteroLocale);
    if (metadata.zoteroLocale != null && !zoteroLocale) {
        throw new Error(`Locale "${code}" has an invalid _meta.zoteroLocale.`);
    }
    return Object.freeze({
        code,
        nativeName: metadata.nativeName.trim(),
        intlLocale,
        direction: metadata.direction,
        ...(zoteroLocale ? { zoteroLocale } : {}),
    });
}

export function buildLocaleRegistry(modules, fallbackLocale = FALLBACK_LOCALE) {
    const entries = [];
    const seenCodes = new Set();

    for (const [path, moduleValue] of Object.entries(modules || {})) {
        const match = path.match(LOCALE_PATH_RE);
        if (!match) {
            throw new Error(`Unexpected locale catalogue path: ${path}`);
        }
        const rawCode = match[1];
        const code = canonicalizeLocale(rawCode);
        if (!code || code !== rawCode) {
            throw new Error(`Locale directory "${rawCode}" must use its canonical BCP-47 form.`);
        }
        const lookupCode = code.toLowerCase();
        if (seenCodes.has(lookupCode)) {
            throw new Error(`Duplicate locale catalogue for "${code}".`);
        }
        seenCodes.add(lookupCode);

        const catalogue = readCatalogue(moduleValue);
        const meta = validateMetadata(code, catalogue._meta);
        const { _meta, ...translation } = catalogue;
        void _meta;
        entries.push({ code, meta, translation });
    }

    const fallbackCode = canonicalizeLocale(fallbackLocale);
    if (!fallbackCode || !entries.some(({ code }) => code === fallbackCode)) {
        throw new Error(`Fallback locale "${fallbackLocale}" has no catalogue.`);
    }

    entries.sort((left, right) => (
        left.meta.nativeName.localeCompare(right.meta.nativeName, 'en', { sensitivity: 'base' })
    ));

    const byCode = new Map(entries.map((entry) => [entry.code.toLowerCase(), entry]));
    const resolveLocale = (candidate) => {
        const canonical = canonicalizeLocale(candidate);
        if (canonical) {
            const exact = byCode.get(canonical.toLowerCase());
            if (exact) return exact.code;
            const baseEntry = byCode.get(canonical.split('-')[0].toLowerCase());
            if (baseEntry) return baseEntry.code;
        }
        return fallbackCode;
    };
    const getLocaleMeta = (candidate) => byCode.get(resolveLocale(candidate).toLowerCase()).meta;

    return Object.freeze({
        availableLocales: Object.freeze(entries.map(({ meta }) => meta)),
        localeResources: Object.freeze(Object.fromEntries(
            entries.map(({ code, translation }) => [code, { translation }])
        )),
        resolveLocale,
        getLocaleMeta,
    });
}

const localeModules = import.meta.glob('./*/translation.json', {
    eager: true,
    import: 'default',
});

const registry = buildLocaleRegistry(localeModules);

export const availableLocales = registry.availableLocales;
export const localeResources = registry.localeResources;
export const resolveLocale = registry.resolveLocale;
export const getLocaleMeta = registry.getLocaleMeta;

export function getIntlLocale(locale) {
    return getLocaleMeta(locale).intlLocale;
}

export function applyLocaleMetadata(meta, targetDocument = globalThis.document) {
    if (targetDocument?.documentElement) {
        targetDocument.documentElement.lang = meta.intlLocale;
        targetDocument.documentElement.dir = meta.direction;
    }
    return meta;
}

export function applyDocumentLocale(locale, targetDocument = globalThis.document) {
    return applyLocaleMetadata(getLocaleMeta(locale), targetDocument);
}
