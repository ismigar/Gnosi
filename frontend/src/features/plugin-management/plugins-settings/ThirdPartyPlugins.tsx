import { PluginUpdates } from './PluginUpdates';
import { ThirdPartyCatalog } from './ThirdPartyCatalog';
import { ThirdPartyInstalled } from './ThirdPartyInstalled';
import type { ThirdPartyPluginsProps } from './thirdPartyModel';
import { useThirdPartyPlugins } from './useThirdPartyPlugins';

export function ThirdPartyPlugins({ section, installedFilter }: ThirdPartyPluginsProps) {
    const controller = useThirdPartyPlugins();
    return (
        <div style={{ marginTop: section === 'installed' ? 28 : 0 }}>
            {section === 'installed' && <ThirdPartyInstalled controller={controller} filter={installedFilter} />}
            {section === 'catalog' && <ThirdPartyCatalog controller={controller} />}
            {section === 'updates' && <PluginUpdates controller={controller} />}
        </div>
    );
}
