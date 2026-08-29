import type { ResourceKey } from 'i18next';

export const FALLBACK_LOCALE = 'en';

const LOCALE_PATH_RE = /^\.\/([^/]+)\/translation\.json$/;

export type LocaleDirection = 'ltr' | 'rtl';
export type TranslationCatalogue = Record<string, unknown>;

export interface LocaleMetadata {
    readonly code: string;
    readonly direction: LocaleDirection;
    readonly intlLocale: string;
    readonly nativeName: string;
    readonly zoteroLocale?: string;
}

export interface LocaleResource {
    readonly [namespace: string]: ResourceKey;
    readonly translation: TranslationCatalogue;
}

export interface LocaleRegistry {
    readonly availableLocales: readonly LocaleMetadata[];
    readonly getLocaleMeta: (candidate?: string | null) => LocaleMetadata;
    readonly localeResources: Readonly<Record<string, LocaleResource>>;
    readonly resolveLocale: (candidate?: string | null) => string;
}

interface LocaleEntry {
    readonly code: string;
    readonly meta: LocaleMetadata;
    readonly translation: TranslationCatalogue;
}

interface DocumentLocaleMetadata {
    readonly direction: LocaleDirection;
    readonly intlLocale: string;
}

interface LocaleDocumentTarget {
    readonly documentElement?: {
        dir: string;
        lang: string;
    };
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function canonicalizeLocale(value?: string | null): string | null {
    const normalized = (value ?? '').trim().replaceAll('_', '-');
    if (!normalized) return null;
    try {
        return Intl.getCanonicalLocales(normalized)[0] ?? null;
    } catch {
        return null;
    }
}

function readCatalogue(moduleValue: unknown): TranslationCatalogue {
    const wrappedDefault = isUnknownRecord(moduleValue) ? moduleValue.default : undefined;
    const catalogue = wrappedDefault || moduleValue;
    if (!isUnknownRecord(catalogue)) {
        throw new Error('Locale catalogue must export a JSON object.');
    }
    return catalogue;
}

function validateMetadata(code: string, metadata: unknown): LocaleMetadata {
    if (!isUnknownRecord(metadata)) {
        throw new Error(`Locale "${code}" is missing the required _meta object.`);
    }
    if (typeof metadata.nativeName !== 'string' || !metadata.nativeName.trim()) {
        throw new Error(`Locale "${code}" must define _meta.nativeName.`);
    }
    const intlLocale = canonicalizeLocale(
        typeof metadata.intlLocale === 'string' ? metadata.intlLocale : null,
    );
    if (!intlLocale) {
        throw new Error(`Locale "${code}" has an invalid _meta.intlLocale.`);
    }
    if (metadata.direction !== 'ltr' && metadata.direction !== 'rtl') {
        throw new Error(`Locale "${code}" must define _meta.direction as "ltr" or "rtl".`);
    }
    const zoteroLocale = metadata.zoteroLocale == null
        ? null
        : canonicalizeLocale(
            typeof metadata.zoteroLocale === 'string' ? metadata.zoteroLocale : null,
        );
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

export function buildLocaleRegistry(
    modules?: Readonly<Record<string, unknown>> | null,
    fallbackLocale = FALLBACK_LOCALE,
): LocaleRegistry {
    const entries: LocaleEntry[] = [];
    const seenCodes = new Set<string>();

    for (const [path, moduleValue] of Object.entries(modules ?? {})) {
        const match = path.match(LOCALE_PATH_RE);
        if (!match) {
            throw new Error(`Unexpected locale catalogue path: ${path}`);
        }
        const rawCode = match[1] ?? '';
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
        const { _meta: ignoredMeta, ...translation } = catalogue;
        void ignoredMeta;
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
    const resolveLocale = (candidate?: string | null): string => {
        const canonical = canonicalizeLocale(candidate);
        if (canonical) {
            const exact = byCode.get(canonical.toLowerCase());
            if (exact) return exact.code;
            const base = canonical.split('-')[0] ?? canonical;
            const baseEntry = byCode.get(base.toLowerCase());
            if (baseEntry) return baseEntry.code;
        }
        return fallbackCode;
    };
    const getLocaleMeta = (candidate?: string | null): LocaleMetadata => {
        const resolvedCode = resolveLocale(candidate);
        const entry = byCode.get(resolvedCode.toLowerCase());
        if (!entry) {
            throw new Error(`Resolved locale "${resolvedCode}" has no catalogue.`);
        }
        return entry.meta;
    };
    const resources: Record<string, LocaleResource> = {};
    for (const { code, translation } of entries) {
        resources[code] = { translation };
    }

    return Object.freeze({
        availableLocales: Object.freeze(entries.map(({ meta }) => meta)),
        localeResources: Object.freeze(resources),
        resolveLocale,
        getLocaleMeta,
    });
}

const localeModules = import.meta.glob<TranslationCatalogue>('./*/translation.json', {
    eager: true,
    import: 'default',
});

const registry = buildLocaleRegistry(localeModules);

export const availableLocales = registry.availableLocales;
export const localeResources = registry.localeResources;
export const resolveLocale = registry.resolveLocale;
export const getLocaleMeta = registry.getLocaleMeta;

export function getIntlLocale(locale?: string | null): string {
    return getLocaleMeta(locale).intlLocale;
}

export function applyLocaleMetadata<T extends DocumentLocaleMetadata>(
    meta: T,
    targetDocument: LocaleDocumentTarget | undefined = globalThis.document,
): T {
    if (targetDocument.documentElement) {
        targetDocument.documentElement.lang = meta.intlLocale;
        targetDocument.documentElement.dir = meta.direction;
    }
    return meta;
}

export function applyDocumentLocale(
    locale?: string | null,
    targetDocument: LocaleDocumentTarget | undefined = globalThis.document,
): LocaleMetadata {
    return applyLocaleMetadata(getLocaleMeta(locale), targetDocument);
}
