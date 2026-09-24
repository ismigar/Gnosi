import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useConfigChanged } from '../../../shared/platform/configEvents';
import { fetchConfiguration } from '../../../shared/api/configuration';
import { principalAssistant } from '../../../shared/ai/assistantProfiles';
import { isRecord } from '../model/agentChatMessageTypes';
import { logChatError } from './chatDiagnostics';

export interface ChatAgentProfile {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly name?: string;
  readonly icon?: string;
  readonly provider?: string;
  readonly model?: string;
}

export function enabledChatAgents(value: unknown): ChatAgentProfile[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((profile) => profile.enabled === false || typeof profile.id !== 'string' ? [] : [{
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
  const loadConfig = useCallback(async () => {
    try {
      const data = await fetchConfiguration();
      const ai = isRecord(data.ai) ? data.ai : {};
      const principal = principalAssistant(enabledChatAgents(ai.agents), typeof ai.active_agent_id === 'string' ? ai.active_agent_id : '');
      // Chat accepts only the current principal, just like application actions.
      // Saved or previously selected profiles must not produce a rejected turn.
      setAgentList(principal ? [principal] : []);
      setSelectedAgentId(principal?.id || '');
    } catch (error) { logChatError('agent-chat-configuration', error); }
  }, [setSelectedAgentId]);
  const onConfigChanged = useCallback(() => { void loadConfig(); }, [loadConfig]);
  useConfigChanged(onConfigChanged);
  useEffect(() => {
    const principal = agentList[0];
    if (principal && principal.id !== selectedAgentId) setSelectedAgentId(principal.id);
  }, [selectedAgentId, agentList, setSelectedAgentId]);
  const agentConfig = agentList[0] || null;
  return { agentConfig, agentList, loadConfig };
}
