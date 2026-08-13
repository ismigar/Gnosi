/**
 * useLocaleSettings.js
 *
 * Single source of truth for format defaults (currency / number / date) for
 * rendering components (Vault table, page properties). Reads
 * `settings` from `/api/config` (with shared cache) and silently refetches
 * when settings change (`gnosi:config-changed` event).
 *
 * Returns options ready for formatUtils: the decimal separator is mapped
 * to a formatting locale (Intl derives separators from the locale), while
 * dates in 'locale' mode use the interface language for month
 * names. See docs/dev_memory/directives/vault_field_formatting.md
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { cachedJson, invalidateCachedJson } from '../lib/cachedJson';
import { useConfigChanged } from '../lib/configEvents';
import { parseCurrencyCode, localeForDecimalSymbol } from '../components/Vault/formatUtils';
import { getIntlLocale } from '../locales/registry';

export function useLocaleSettings() {
    const { i18n } = useTranslation();
    const [settings, setSettings] = useState(null);

    const load = useCallback(() => {
        cachedJson('/api/config', { ttl: 5000 })
            .then(cfg => setSettings(cfg?.settings || {}))
            .catch(() => { /* no config → defaults */ });
    }, []);

    useEffect(() => { load(); }, [load]);
    useConfigChanged(() => { invalidateCachedJson('/api/config'); load(); });

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
