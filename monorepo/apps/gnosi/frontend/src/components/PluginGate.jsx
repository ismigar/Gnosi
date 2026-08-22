import React from 'react';
import { Puzzle, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BUILTIN_PLUGIN_BY_ID } from '../plugins/registry';
import { usePlugins } from '../plugins/usePlugins';

function openPluginSettings(pluginId) {
    window.dispatchEvent(new CustomEvent('open-settings', {
        detail: { tab: 'plugins', pluginId },
    }));
}

export function PluginRoute({ pluginId, children }) {
    const { t } = useTranslation();
    const { isEnabled, loaded } = usePlugins();

    if (!loaded) {
        return (
            <div className="gnosi-route-skeleton" role="status" aria-live="polite">
                <span className="gnosi-skeleton gnosi-route-skeleton__title" />
                <span className="sr-only">{t('common.loading', 'Loading...')}</span>
            </div>
        );
    }

    if (isEnabled(pluginId)) return children;

    const plugin = BUILTIN_PLUGIN_BY_ID[pluginId];
    const name = t(`settings.plugins.catalog.${pluginId}.name`, plugin?.name || pluginId);
    return (
        <section
            className="flex min-h-[60vh] items-center justify-center px-6 py-12"
            aria-labelledby="disabled-plugin-title"
        >
            <div className="max-w-lg rounded-3xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-8 text-center shadow-sm">
                <Puzzle aria-hidden="true" className="mx-auto mb-4 text-indigo-500" size={38} />
                <h1 id="disabled-plugin-title" className="mb-3 text-xl font-semibold text-[var(--text-primary)]">
                    {t('settings.plugins.activation_required_title', '{{name}} is disabled', { name })}
                </h1>
                <p className="mb-6 text-sm leading-6 text-[var(--text-secondary)]">
                    {t('settings.plugins.activation_required_description', 'Activate this plugin to use the feature. Its previous data and settings are preserved.')}
                </p>
                <button
                    type="button"
                    className="btn-gnosi-primary"
                    onClick={() => openPluginSettings(pluginId)}
                >
                    <Settings size={16} aria-hidden="true" />
                    {t('settings.plugins.open_plugins_settings', 'Open plugin settings')}
                </button>
            </div>
        </section>
    );
}

export function PluginSurface({ pluginIds, children }) {
    const { isEnabled, loaded } = usePlugins();
    const required = Array.isArray(pluginIds) ? pluginIds : [pluginIds];
    if (!loaded || !required.every(isEnabled)) return null;
    return children;
}

export default PluginRoute;
