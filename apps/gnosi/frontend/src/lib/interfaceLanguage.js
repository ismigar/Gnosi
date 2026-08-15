export const DEFAULT_INTERFACE_LANGUAGE = 'en';
export const INTERFACE_LANGUAGE_STORAGE_KEY = 'i18nextLng';
export const SUPPORTED_INTERFACE_LANGUAGES = Object.freeze(['en', 'es', 'fr', 'ca']);

export function normalizeInterfaceLanguage(value) {
    const language = String(value || '').trim().split('-', 1)[0].toLowerCase();
    return SUPPORTED_INTERFACE_LANGUAGES.includes(language) ? language : null;
}

export function getStoredInterfaceLanguage(storage = globalThis.localStorage) {
    try {
        return normalizeInterfaceLanguage(storage?.getItem(INTERFACE_LANGUAGE_STORAGE_KEY));
    } catch {
        return null;
    }
}

export async function resolveInitialInterfaceLanguage({
    storage = globalThis.localStorage,
    fetchConfig = globalThis.fetch,
} = {}) {
    const storedLanguage = getStoredInterfaceLanguage(storage);
    if (storedLanguage) return storedLanguage;

    if (typeof fetchConfig === 'function') {
        try {
            const response = await fetchConfig('/api/config');
            if (response?.ok) {
                const config = await response.json();
                const configuredLanguage = normalizeInterfaceLanguage(config?.settings?.language);
                if (configuredLanguage) return configuredLanguage;
            }
        } catch {
            // English remains the deterministic default when configuration is unavailable.
        }
    }

    return DEFAULT_INTERFACE_LANGUAGE;
}

export async function initializeInterfaceLanguage(i18n, options) {
    const language = await resolveInitialInterfaceLanguage(options);
    if (i18n.resolvedLanguage !== language) {
        await i18n.changeLanguage(language);
    }
    return language;
}

export async function setInterfaceLanguage(
    i18n,
    value,
    storage = globalThis.localStorage,
) {
    const language = normalizeInterfaceLanguage(value) || DEFAULT_INTERFACE_LANGUAGE;
    try {
        storage?.setItem(INTERFACE_LANGUAGE_STORAGE_KEY, language);
    } catch {
        // The live language still changes when storage is unavailable or blocked.
    }
    await i18n.changeLanguage(language);
    return language;
}
