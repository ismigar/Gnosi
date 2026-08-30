import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import {
    applyDocumentLocale,
    availableLocales,
    FALLBACK_LOCALE,
    localeResources,
    resolveLocale,
} from './locales/registry';

void i18n
    // detect user language
    // learn more: https://github.com/i18next/i18next-browser-languageDetector
    .use(LanguageDetector)
    // pass the i18n instance to react-i18next.
    .use(initReactI18next)
    // init i18next
    // for all options read: https://www.i18next.com/overview/configuration-options
    .init({
        debug: false,
        fallbackLng: FALLBACK_LOCALE,
        supportedLngs: availableLocales.map(({ code }) => code),
        detection: {
            convertDetectedLanguage: resolveLocale,
        },
        interpolation: {
            escapeValue: false, // not needed for react as it escapes by default
        },
        resources: localeResources,
    });

const syncDocumentLocale = (language?: string): void => {
    applyDocumentLocale(i18n.resolvedLanguage || language || FALLBACK_LOCALE);
};

i18n.on('languageChanged', syncDocumentLocale);
syncDocumentLocale(i18n.language);

export default i18n;
