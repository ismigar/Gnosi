import { isRecord } from '../model/agentChatMessageTypes';
export function boundedMemoryProvenance(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).filter(item => typeof item.memory_id === 'string' && typeof item.agent_id === 'string' && typeof item.text === 'string').slice(0, 100).map(item => ({
    memory_id: typeof item.memory_id === 'string' ? item.memory_id : '', agent_id: typeof item.agent_id === 'string' ? item.agent_id : '', text: typeof item.text === 'string' ? item.text.slice(0, 10000) : '',
    revision: Number(item.revision) || 1, category: typeof item.category === 'string' ? item.category : 'preference',
    scope_kind: typeof item.scope_kind === 'string' ? item.scope_kind : 'agent', scope_id: typeof item.scope_id === 'string' ? item.scope_id : '',
    enabled: item.enabled !== false, expires_at: typeof item.expires_at === 'string' ? item.expires_at : null,
  }));
}
