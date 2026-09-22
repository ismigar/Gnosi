import { PrincipalAgentReference } from '../../../shared/ui/settings/PrincipalAgentReference';
import type { PluginLlmWikiSettingsResponse } from '../../../shared/api/plugins';
import { type PluginConfigProps } from './pluginSettingsModel';

interface Props extends PluginConfigProps {
    readonly agentId: string;
    readonly agents: NonNullable<PluginLlmWikiSettingsResponse['agents']>;
    readonly busy: boolean;
    readonly onSelect: (agentId: string) => Promise<void>;
}

export function LlmWikiAgentSettings(_props: Props) {
    return <PrincipalAgentReference operation="knowledge" />;
}
