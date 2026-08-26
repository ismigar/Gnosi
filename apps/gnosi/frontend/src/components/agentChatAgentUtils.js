export const resolveAgentRuntimeSelection = (
    agents,
    forcedAgentId = '',
    selectedAgentId = '',
    activeAgentId = '',
) => {
    const available = Array.isArray(agents) ? agents : [];
    const requestedId = forcedAgentId || selectedAgentId || activeAgentId;
    const agent = available.find((item) => item.id === requestedId)
        || available.find((item) => item.id === activeAgentId)
        || available[0]
        || null;
    return {
        agent,
        selectedAgentId: forcedAgentId || agent?.id || requestedId || '',
    };
};
