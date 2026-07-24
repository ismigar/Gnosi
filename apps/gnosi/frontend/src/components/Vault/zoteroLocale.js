// Single source of truth for mapping the react-i18next UI language
// (ca / es / en / fr, or regional variants like en-US) to the Zotero locale
// code used both by ZOTERO_TYPE_LABELS (the item-type badge in
// MetadataLookupModal) and by the zotero/reader viewer chrome (ZoteroReaderTab).
//
// Keep this language set in sync with frontend/src/i18n.js and
// build_constants.py::LOCALES. Any language not listed falls back to 'en-US',
// which is always a valid Zotero locale.
const UI_LANG_TO_ZOTERO_LOCALE = {
    ca: 'ca-AD',
    es: 'es-ES',
    en: 'en-US',
    fr: 'fr-FR',
};

/**
 * Resolve a react-i18next language to a Zotero locale code.
 * @param {string|undefined} uiLanguage - e.g. i18n.language ('ca', 'en-US', 'fr').
 * @returns {string} A Zotero locale key ('ca-AD' | 'es-ES' | 'en-US' | 'fr-FR').
 */
export function uiLangToZoteroLocale(uiLanguage) {
    const base = String(uiLanguage || 'en').split('-')[0];
    return UI_LANG_TO_ZOTERO_LOCALE[base] || 'en-US';
}
