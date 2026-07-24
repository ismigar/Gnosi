import { getLocaleMeta } from '../../locales/registry';

/**
 * Resolve a react-i18next language to a Zotero locale code.
 * @param {string|undefined} uiLanguage - e.g. i18n.language ('ca', 'en-US', 'fr').
 * @returns {string} A Zotero locale key, falling back to 'en-US'.
 */
export function uiLangToZoteroLocale(uiLanguage) {
    return getLocaleMeta(uiLanguage).zoteroLocale || 'en-US';
}
