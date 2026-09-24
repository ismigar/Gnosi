/** Resolve the configured principal without silently replacing an explicit choice. */
export function principalAssistant<T extends { readonly id: string }>(
    agents: readonly T[], activeId = '',
): T | undefined {
    const personal = agents.filter(agent => !('managed_by' in agent) || !agent.managed_by);
    if (activeId) return personal.find(agent => agent.id === activeId);
    return personal.find(agent => !('enabled' in agent) || agent.enabled !== false);
}
