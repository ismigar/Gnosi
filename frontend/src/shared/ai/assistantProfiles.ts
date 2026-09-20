/** Resolve the configured principal without silently replacing an explicit choice. */
export function principalAssistant<T extends { readonly id: string }>(
    agents: readonly T[], activeId = '',
): T | undefined {
    if (activeId) return agents.find(agent => agent.id === activeId);
    return agents.find(agent => !('enabled' in agent) || agent.enabled !== false);
}
