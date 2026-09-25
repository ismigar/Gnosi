import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { useConfigChanged } from '../../../shared/platform/configEvents';
import { fetchConfiguration } from '../../../shared/api/configuration';
import { fetchAiModelComparison } from '../../../shared/api/ai';
import { principalAssistant } from '../../../shared/ai/assistantProfiles';
import { isRecord } from '../model/agentChatMessageTypes';
import { logChatError } from './chatDiagnostics';

export interface ChatAgentProfile {
  readonly modelProfile?: string;
  readonly [key: string]: unknown;
  readonly id: string;
  readonly name?: string;
  readonly icon?: string;
  readonly provider?: string;
  readonly model?: string;
}

export function enabledChatAgents(value: unknown): ChatAgentProfile[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((profile) => profile.enabled === false || profile.plugin_suspended === true || typeof profile.id !== 'string' ? [] : [{
    ...profile, id: profile.id,
    name: typeof profile.name === 'string' ? profile.name : undefined,
    icon: typeof profile.icon === 'string' ? profile.icon : undefined,
    provider: typeof profile.provider === 'string' ? profile.provider : undefined,
    model: typeof profile.model === 'string' ? profile.model : undefined,
  }]);
}

interface Options {
  readonly selectedAgentId: string;
  readonly setSelectedAgentId: Dispatch<SetStateAction<string>>;
}
export function useChatConfiguration({ selectedAgentId, setSelectedAgentId }: Options) {
  const [agentList, setAgentList] = useState<ChatAgentProfile[]>([]);
  const [defaultAgentId, setDefaultAgentId] = useState('');
  const loadConfig = useCallback(async () => {
    try {
      const data = await fetchConfiguration();
      const ai = isRecord(data.ai) ? data.ai : {};
      const profiles = enabledChatAgents(ai.agents).filter(profile => profile.managed_by !== 'llm-wiki');
      const principal = principalAssistant(profiles, typeof ai.active_agent_id === 'string' ? ai.active_agent_id : '');
      setAgentList(profiles);
      setDefaultAgentId(principal?.id || '');
      // Only initialize an unbound conversation. Existing histories keep their identity.
      setSelectedAgentId(current => current || principal?.id || '');
      // Catalog labels enrich the selector without delaying the conversation.
      void fetchAiModelComparison().then(comparison => {
        if (!Array.isArray(comparison.models)) return;
        setAgentList(current => current.map(profile => {
          const model = comparison.models.find(candidate => candidate.routes.some(route =>
            route.provider === profile.provider && route.model_id === profile.model,
          ));
          return { ...profile, modelProfile: model?.profile };
        }));
      }).catch(() => {});
    } catch (error) { logChatError('agent-chat-configuration', error); }
  }, [setSelectedAgentId]);
  const onConfigChanged = useCallback(() => { void loadConfig(); }, [loadConfig]);
  useConfigChanged(onConfigChanged);
  const agentConfig = agentList.find(profile => profile.id === selectedAgentId) || null;
  return { agentConfig, agentList, defaultAgentId, loadConfig };
}
