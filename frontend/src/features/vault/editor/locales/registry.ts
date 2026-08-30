import * as blockNoteLocales from '@blocknote/core/locales';
import type { Dictionary } from '@blocknote/core';

import { resolveLocale } from '../../../../shared/i18n/locales/registry';
import { blocknoteCa } from './ca';

const CUSTOM_DICTIONARIES: Readonly<Record<string, Dictionary>> = {
    ca: blocknoteCa,
};

export function localeExportName(locale: string): string {
    const [language = '', ...subtags] = locale.split('-');
    return language.toLowerCase() + subtags
        .map((subtag) => subtag.length === 2
            ? subtag.toUpperCase()
            : subtag.charAt(0).toUpperCase() + subtag.slice(1).toLowerCase())
        .join('');
}

function packageDictionary(name: string): Dictionary | undefined {
    const localeExports: unknown = blockNoteLocales;
    if (typeof localeExports !== 'object' || localeExports === null) return undefined;
    const candidate = Reflect.get(localeExports, name) as unknown;
    return typeof candidate === 'object' && candidate !== null
        ? candidate as Dictionary
        : undefined;
}

export function resolveBlockNoteDictionary(language?: string | null): Dictionary {
    const locale = resolveLocale(language);
    const base = (locale.split('-')[0] ?? 'en').toLowerCase();
    return CUSTOM_DICTIONARIES[locale]
        || CUSTOM_DICTIONARIES[base]
        || packageDictionary(localeExportName(locale))
        || packageDictionary(base)
        || blockNoteLocales.en;
}
