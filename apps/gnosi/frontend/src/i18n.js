import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en/translation.json';
import es from './locales/es/translation.json';
import fr from './locales/fr/translation.json';
import ca from './locales/ca/translation.json';
import {
    DEFAULT_INTERFACE_LANGUAGE,
    getStoredInterfaceLanguage,
    SUPPORTED_INTERFACE_LANGUAGES,
} from './lib/interfaceLanguage';

i18n
    .use(initReactI18next)
    .init({
        debug: false,
        lng: getStoredInterfaceLanguage() || DEFAULT_INTERFACE_LANGUAGE,
        fallbackLng: DEFAULT_INTERFACE_LANGUAGE,
        supportedLngs: SUPPORTED_INTERFACE_LANGUAGES,
        nonExplicitSupportedLngs: true,
        interpolation: {
            escapeValue: false, // React escapes interpolated values by default.
        },
        resources: {
            en: {
                translation: en
            },
            es: {
                translation: es
            },
            fr: {
                translation: fr
            },
            ca: {
                translation: ca
            }
        }
    });

export default i18n;
