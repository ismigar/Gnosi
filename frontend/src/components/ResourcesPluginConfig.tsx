import './ResourcesPluginConfig.css';

import { ResourcesPluginConfigView } from './resources-plugin-config/ResourcesPluginConfigView';
import { useResourcesPluginConfig } from './resources-plugin-config/useResourcesPluginConfig';

export default function ResourcesPluginConfig() {
    const controller = useResourcesPluginConfig();
    return <ResourcesPluginConfigView controller={controller} />;
}
