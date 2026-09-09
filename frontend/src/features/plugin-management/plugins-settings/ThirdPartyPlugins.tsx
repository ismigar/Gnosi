import { PluginUpdates } from './PluginUpdates';
import { ThirdPartyCatalog } from './ThirdPartyCatalog';
import { ThirdPartyInstalled } from './ThirdPartyInstalled';
import type { ThirdPartyPluginsProps } from './thirdPartyModel';
import { useThirdPartyPlugins } from './useThirdPartyPlugins';

export function ThirdPartyPlugins({ section, installedFilter }: ThirdPartyPluginsProps) {
    const { t } = useTranslation();
    const controller = useThirdPartyPlugins(section);
    if (controller.loadFailed) return (
        <div role="alert">
            {t('settings.plugins.llm_wiki_load_error')}
            <button type="button" onClick={() => { void controller.retryLoad(); }}>{t('common.retry')}</button>
        </div>
    );
    return (
        <div style={{ marginTop: section === 'installed' ? 28 : 0 }}>
            {section === 'installed' && <ThirdPartyInstalled controller={controller} filter={installedFilter} />}
            {section === 'catalog' && <ThirdPartyCatalog controller={controller} />}
            {section === 'updates' && <PluginUpdates controller={controller} />}
        </div>
    );
}
import { useTranslation } from 'react-i18next';
