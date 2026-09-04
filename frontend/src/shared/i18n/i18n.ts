import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
    applyDocumentLocale,
    availableLocales,
    FALLBACK_LOCALE,
    loadLocaleResource,
    resolveLocale,
} from './locales/registry';

const i18n = createInstance();

let initialization: Promise<void> | null = null;

export function initializeI18n(language?: string | null): Promise<void> {
    const locale = resolveLocale(language);
    initialization ??= loadLocaleResource(locale).then(async (resource) => {
        await i18n.use(initReactI18next).init({
        debug: false,
        lng: locale,
        fallbackLng: false,
        supportedLngs: availableLocales.map(({ code }) => code),
        interpolation: {
            escapeValue: false, // not needed for react as it escapes by default
        },
        resources: { [locale]: resource },
        });
    });
    return initialization;
}

export async function changeI18nLanguage(language?: string | null): Promise<string> {
    const locale = resolveLocale(language);
    if (!i18n.isInitialized) await initializeI18n(locale);
    if (!i18n.hasResourceBundle(locale, 'translation')) {
        const resource = await loadLocaleResource(locale);
        i18n.addResourceBundle(locale, 'translation', resource.translation, true, true);
    }
    await i18n.changeLanguage(locale);
    return locale;
}

const syncDocumentLocale = (language?: string): void => {
    applyDocumentLocale(i18n.resolvedLanguage || language || FALLBACK_LOCALE);
};

i18n.on('languageChanged', syncDocumentLocale);

export default i18n;
