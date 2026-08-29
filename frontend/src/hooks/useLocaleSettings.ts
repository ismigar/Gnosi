/**
 * useLocaleSettings.ts
 *
 * Single source of truth for format defaults (currency / number / date) for
 * rendering components (Vault table, page properties). Reads configuration
 * settings through the shared API client (with shared cache) and silently refetches
 * when settings change (`gnosi:config-changed` event).
 *
 * Returns options ready for formatUtils: the decimal separator is mapped
 * to a formatting locale (Intl derives separators from the locale), while
 * dates in 'locale' mode use the interface language for month
 * names. See docs/dev_memory/directives/vault_field_formatting.md
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfigChanged } from '../lib/configEvents';
import { parseCurrencyCode, localeForDecimalSymbol } from '../components/Vault/formatUtils';
import { getIntlLocale } from '../locales/registry';
import { fetchConfiguration } from '../shared/api/configuration';

interface LocaleConfigurationSettings {
    readonly currency?: string;
    readonly date_format?: string;
    readonly decimal_symbol?: string;
}

export interface LocaleFormatSettings {
    readonly currencyCode: string;
    readonly dateFormat: string;
    readonly dateLocale: string;
    readonly decimalSymbol: string;
    readonly numberLocale: string;
}

const CONFIG_CACHE_TTL = 5000;
let cachedSettings: LocaleConfigurationSettings | null = null;
let cachedSettingsAt = 0;
let settingsRequest: Promise<LocaleConfigurationSettings> | null = null;

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLocaleSettings(value: unknown): LocaleConfigurationSettings {
    if (!isUnknownRecord(value)) return {};
    return {
        ...(typeof value.currency === 'string' ? { currency: value.currency } : {}),
        ...(typeof value.date_format === 'string' ? { date_format: value.date_format } : {}),
        ...(typeof value.decimal_symbol === 'string'
            ? { decimal_symbol: value.decimal_symbol }
            : {}),
    };
}

async function fetchLocaleSettings(): Promise<LocaleConfigurationSettings> {
    const now = Date.now();
    if (cachedSettings && now - cachedSettingsAt < CONFIG_CACHE_TTL) {
        return cachedSettings;
    }

    if (!settingsRequest) {
        settingsRequest = fetchConfiguration()
            .then((config) => {
                cachedSettings = normalizeLocaleSettings(config.settings);
                cachedSettingsAt = Date.now();
                return cachedSettings;
            })
            .finally(() => {
                settingsRequest = null;
            });
    }

    return settingsRequest;
}

function invalidateLocaleSettings(): void {
    cachedSettings = null;
    cachedSettingsAt = 0;
}

export function useLocaleSettings(): LocaleFormatSettings {
    const { i18n } = useTranslation();
    const [settings, setSettings] = useState<LocaleConfigurationSettings | null>(null);

    const load = useCallback(() => {
        void fetchLocaleSettings()
            .then(setSettings)
            .catch(() => { /* no config → defaults */ });
    }, []);

    useEffect(() => { load(); }, [load]);
    useConfigChanged(() => { invalidateLocaleSettings(); load(); });

    const decimalSymbol = settings?.decimal_symbol || ',';
    const dateLocale = getIntlLocale(i18n.resolvedLanguage || i18n.language);
    return {
        currencyCode: parseCurrencyCode(settings?.currency, 'EUR'),
        decimalSymbol,
        dateFormat: settings?.date_format || 'locale',
        numberLocale: localeForDecimalSymbol(decimalSymbol) || dateLocale,
        dateLocale,
    };
}
