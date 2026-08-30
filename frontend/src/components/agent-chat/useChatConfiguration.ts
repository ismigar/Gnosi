import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useConfigChanged } from '../../lib/configEvents';
import { fetchConfiguration } from '../../shared/api/configuration';
import { resolveAgentRuntimeSelection } from '../agentChatAgentUtils';
import { isRecord } from '../agentChatMessageTypes';
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
  readonly forcedAgentId: string;
  readonly selectedAgentId: string;
  readonly setSelectedAgentId: Dispatch<SetStateAction<string>>;
}
export function useChatConfiguration({ forcedAgentId, selectedAgentId, setSelectedAgentId }: Options) {
  const [loadedAgent, setLoadedAgent] = useState<ChatAgentProfile | null>(null);
  const [agentList, setAgentList] = useState<ChatAgentProfile[]>([]);
  const loadConfig = useCallback(async () => {
    try {
      const data = await fetchConfiguration();
      const ai = isRecord(data.ai) ? data.ai : {};
      const agents = enabledChatAgents(ai.agents);
      setAgentList(agents);
      const selection = resolveAgentRuntimeSelection(agents, forcedAgentId, selectedAgentId, typeof ai.active_agent_id === 'string' ? ai.active_agent_id : '');
      if (selection.agent) setLoadedAgent(selection.agent);
      if (selection.selectedAgentId) setSelectedAgentId(selection.selectedAgentId);
    } catch (error) { logChatError('agent-chat-configuration', error); }
  }, [forcedAgentId, selectedAgentId, setSelectedAgentId]);
  const onConfigChanged = useCallback(() => { void loadConfig(); }, [loadConfig]);
  useConfigChanged(onConfigChanged);
  useEffect(() => {
    if (!agentList.length) return;
    const selection = resolveAgentRuntimeSelection(agentList, forcedAgentId, selectedAgentId, '');
    if (selection.agent) {
      if (selection.selectedAgentId !== selectedAgentId) setSelectedAgentId(selection.selectedAgentId);
    }
  }, [forcedAgentId, selectedAgentId, agentList, setSelectedAgentId]);
  const agentConfig = resolveAgentRuntimeSelection(agentList, forcedAgentId, selectedAgentId, '').agent || loadedAgent;
  return { agentConfig, agentList, loadConfig };
}
