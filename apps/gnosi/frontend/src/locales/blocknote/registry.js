import * as blockNoteLocales from '@blocknote/core/locales';

import { resolveLocale } from '../registry';
import { blocknoteCa } from './ca';

const CUSTOM_DICTIONARIES = {
    ca: blocknoteCa,
};

export function localeExportName(locale) {
    const [language, ...subtags] = locale.split('-');
    return language.toLowerCase() + subtags
        .map((subtag) => subtag.length === 2
            ? subtag.toUpperCase()
            : subtag.charAt(0).toUpperCase() + subtag.slice(1).toLowerCase())
        .join('');
}

export function resolveBlockNoteDictionary(language) {
    const locale = resolveLocale(language);
    const base = locale.split('-')[0].toLowerCase();
    return CUSTOM_DICTIONARIES[locale]
        || CUSTOM_DICTIONARIES[base]
        || blockNoteLocales[localeExportName(locale)]
        || blockNoteLocales[base]
        || blockNoteLocales.en;
}
