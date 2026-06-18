/**
 * useLocaleSettings.js
 *
 * Font única dels defaults de format (moneda / número / data) per als
 * components de render (taula del Vault, propietats de pàgina). Llegeix
 * `settings` de `/api/config` (amb cache compartit) i refetcha en silenci
 * quan els settings canvien (event `gnosi:config-changed`).
 *
 * Torna les opcions llestes per a formatUtils: el separador decimal es mapeja
 * a un locale de formatació (Intl deriva els separadors del locale), mentre
 * que les dates en mode 'locale' usen l'idioma de la interfície per als noms
 * de mes. Vegeu docs/dev_memory/directives/vault_field_formatting.md
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { cachedJson, invalidateCachedJson } from '../lib/cachedJson';
import { useConfigChanged } from '../lib/configEvents';
import { parseCurrencyCode, localeForDecimalSymbol } from '../components/Vault/formatUtils';

export function useLocaleSettings() {
    const { i18n } = useTranslation();
    const [settings, setSettings] = useState(null);

    const load = useCallback(() => {
        cachedJson('/api/config', { ttl: 5000 })
            .then(cfg => setSettings(cfg?.settings || {}))
            .catch(() => { /* sense config → defaults */ });
    }, []);

    useEffect(() => { load(); }, [load]);
    useConfigChanged(() => { invalidateCachedJson('/api/config'); load(); });

    const decimalSymbol = settings?.decimal_symbol || ',';
    const dateLocale = i18n.language || 'ca';
    return {
        currencyCode: parseCurrencyCode(settings?.currency, 'EUR'),
        decimalSymbol,
        dateFormat: settings?.date_format || 'locale',
        numberLocale: localeForDecimalSymbol(decimalSymbol) || dateLocale,
        dateLocale,
    };
}
