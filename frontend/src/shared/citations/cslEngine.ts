import CSL, { type Engine } from 'citeproc';

import { logError } from '../notifications/notifyError';
import { fetchCslStyles } from '../api/citation-io';
import { transportFetch } from '../api/transports';
import {
    recursosPageToCsl,
    resolveCslType,
    type CslItem,
    type CslItemMap,
    type CslName,
    type VaultResourcePage,
} from './cslItemMapper';

export {
    recursosPageToCsl,
    resolveCslType,
    type CslItem,
    type CslItemMap,
    type CslName,
    type VaultResourcePage,
};

export interface CslStyleOption {
    readonly file: string;
    readonly id: string;
    readonly label: string;
    readonly locale: string;
}

export interface FetchAvailableStylesOptions {
    readonly force?: boolean;
}

export interface RenderedBibliography {
    readonly entries: readonly string[];
    readonly formatting: Readonly<Record<string, unknown>>;
}

const DEFAULT_STYLE: CslStyleOption = {
    file: 'apa.csl',
    id: 'apa',
    label: 'APA 7th edition',
    locale: 'en-US',
};

export const AVAILABLE_STYLES: CslStyleOption[] = [
    DEFAULT_STYLE,
    {
        file: 'chicago-author-date.csl',
        id: 'chicago-author-date',
        label: 'Chicago Author-Date',
        locale: 'en-US',
    },
    {
        file: 'modern-language-association.csl',
        id: 'modern-language-association',
        label: 'MLA 9th edition',
        locale: 'en-US',
    },
    { file: 'ieee.csl', id: 'ieee', label: 'IEEE', locale: 'en-US' },
];

let dynamicStylesCache: CslStyleOption[] | null = null;

export async function fetchAvailableStyles(
    { force = false }: FetchAvailableStylesOptions = {},
): Promise<CslStyleOption[]> {
    if (dynamicStylesCache && !force) return dynamicStylesCache;
    try {
        const catalog = await fetchCslStyles();
        const styles = catalog.map((style): CslStyleOption => ({
            file: style.file,
            id: style.id,
            label: style.title || style.id,
            locale: 'en-US',
        }));
        if (styles.length > 0) {
            dynamicStylesCache = styles;
            return styles;
        }
    } catch {
        // The bundled styles keep citation UI available while the catalog is offline.
    }
    dynamicStylesCache = AVAILABLE_STYLES;
    return AVAILABLE_STYLES;
}

export function invalidateAvailableStylesCache(): void {
    dynamicStylesCache = null;
}

export const AVAILABLE_LOCALES: string[] = ['ca-AD', 'es-ES', 'en-US', 'en-GB'];

const styleCache = new Map<string, string>();
const localeCache = new Map<string, string>();
const engineCache = new Map<string, Engine>();

async function fetchText(url: string): Promise<string> {
    const response = await transportFetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${String(response.status)} for ${url}`);
    }
    return response.text();
}

async function loadStyle(file: string): Promise<string> {
    const cached = styleCache.get(file);
    if (cached !== undefined) return cached;
    const xml = await fetchText(`/csl/styles/${file}`);
    styleCache.set(file, xml);
    return xml;
}

async function loadLocale(language: string): Promise<string> {
    const cached = localeCache.get(language);
    if (cached !== undefined) return cached;
    const xml = await fetchText(`/csl/locales/locales-${language}.xml`);
    localeCache.set(language, xml);
    return xml;
}

export async function getEngine(
    styleId: string,
    locale: string,
    items: CslItemMap,
): Promise<Engine> {
    let style = AVAILABLE_STYLES.find((candidate) => candidate.id === styleId);
    if (!style && styleId) {
        const dynamicStyles = await fetchAvailableStyles();
        style = dynamicStyles.find((candidate) => candidate.id === styleId);
    }
    style ??= DEFAULT_STYLE;
    const styleXml = await loadStyle(style.file);
    await Promise.all([...new Set([locale, 'en-US'])].map(loadLocale));

    const cacheKey = `${style.id}|${locale}`;
    let engine = engineCache.get(cacheKey);
    if (!engine) {
        engine = new CSL.Engine({
            retrieveItem: (id) => items[id] ?? null,
            retrieveLocale: (language) => (
                localeCache.get(language) || localeCache.get('en-US') || ''
            ),
        }, styleXml, locale);
        engineCache.set(cacheKey, engine);
    }
    return engine;
}

export async function renderInlineCitation(
    citationKey: string,
    items: CslItemMap,
    styleId = 'apa',
    locale = 'en-US',
): Promise<string> {
    if (!items[citationKey]) return `[?@${citationKey}]`;
    const engine = await getEngine(styleId, locale, items);
    engine.sys.retrieveItem = (id) => items[id] ?? null;
    try {
        engine.updateItems([citationKey]);
        const result = engine.processCitationCluster({
            properties: { noteIndex: 0 },
            citationItems: [{ id: citationKey }],
        }, [], []);
        return result[1].at(0)?.[1] || `(${citationKey})`;
    } catch (error: unknown) {
        logError('citeproc-render', error);
        return `(${citationKey})`;
    }
}

export async function renderBibliography(
    citationKeys: readonly string[],
    items: CslItemMap,
    styleId = 'apa',
    locale = 'en-US',
): Promise<RenderedBibliography | null> {
    if (citationKeys.length === 0) return null;
    const engine = await getEngine(styleId, locale, items);
    engine.sys.retrieveItem = (id) => items[id] ?? null;
    try {
        engine.updateItems(citationKeys);
        const bibliography = engine.makeBibliography();
        if (!bibliography) return null;
        return { entries: bibliography[1], formatting: bibliography[0] };
    } catch (error: unknown) {
        logError('citeproc-bibliography', error);
        return null;
    }
}
