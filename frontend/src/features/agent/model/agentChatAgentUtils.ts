export interface AgentRuntimeProfile {
  readonly id: string;
}


export interface AgentRuntimeSelection<T extends AgentRuntimeProfile> {
  readonly agent: T | null;
  readonly selectedAgentId: string;
}


export const resolveAgentRuntimeSelection = <T extends AgentRuntimeProfile>(
  agents: readonly T[] | null | undefined,
  forcedAgentId = '',
  selectedAgentId = '',
  activeAgentId = '',
): AgentRuntimeSelection<T> => {
  const available: readonly T[] = agents ?? [];
  const requestedId = forcedAgentId || selectedAgentId || activeAgentId;
  const agent = available.find((item) => item.id === requestedId)
    ?? available.find((item) => item.id === activeAgentId)
    ?? available[0]
    ?? null;
  return {
    agent,
    selectedAgentId: forcedAgentId || agent?.id || requestedId || '',
  };
};
