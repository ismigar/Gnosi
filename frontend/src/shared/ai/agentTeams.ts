export const TEAM_ROLES = ['director', 'expert', 'allrounder', 'documentalist', 'administrative', 'worker'] as const;
export type TeamRole = typeof TEAM_ROLES[number];
export interface AgentTeam {
    version: 1;
    enabled: boolean;
    director_id: string;
    members: { agent_id: string; roles: TeamRole[] }[];
    direct_routes: { operation: string; agent_ids: string[] }[];
    temporary: { enabled: boolean; models: { provider: string; model: string }[]; skill_ids: string[] };
}
export const TEAM_SKILL = 'core.gnosi-coordination';
export const EMPTY_TEAM: AgentTeam = { version: 1, enabled: false, director_id: '', members: [], direct_routes: [], temporary: { enabled: false, models: [], skill_ids: [] } };
export const TEAM_OPERATIONS = ['writing', 'reader', 'podcast', 'notebook', 'literature', 'mail', 'social', 'meeting', 'translation', 'tables', 'knowledge', 'capture', 'learning'] as const;

export function withTeam<T extends { id: string; skill_ids?: string[]; team?: AgentTeam }>(agents: readonly T[], team: AgentTeam, initiators: readonly string[], previousDirectorId = team.director_id): T[] {
    return agents.map(agent => ({ ...agent,
        ...(initiators.includes(agent.id) || agent.id === team.director_id ? { team } : agent.team?.director_id === previousDirectorId ? { team: { ...agent.team, enabled: false } } : {}),
        ...(team.enabled && agent.id === team.director_id ? { skill_ids: [...new Set([...(agent.skill_ids ?? []), TEAM_SKILL])] } : {}),
    }));
}

export function normalizedTeam(value: Partial<AgentTeam> | undefined, principalId: string): AgentTeam {
    return { ...EMPTY_TEAM, ...value, director_id: value?.director_id || principalId,
        members: value?.members ?? [], direct_routes: value?.direct_routes ?? [],
        temporary: { ...EMPTY_TEAM.temporary, ...value?.temporary },
    };
}

/** Move the existing team with an explicit principal choice, preserving its state. */
export function changeTeamPrincipal<T extends { id: string; enabled?: boolean; skill_ids?: string[]; team?: AgentTeam }>(agents: readonly T[], nextId: string, previousId: string): T[] {
    const enabled = agents.map(agent => agent.id === nextId ? { ...agent, enabled: true } : agent);
    const previous = agents.find(agent => agent.id === previousId)?.team ?? agents.find(agent => agent.id === nextId)?.team;
    if (!previous) return enabled;
    const members = previous.members.filter(member => member.agent_id !== nextId);
    const team = { ...previous, director_id: nextId, members, enabled: previous.enabled && members.length > 0,
        direct_routes: previous.direct_routes.map(route => ({ ...route, agent_ids: route.agent_ids.filter(id => members.some(member => member.agent_id === id)) })).filter(route => route.agent_ids.length),
    };
    const requesters = team.enabled ? agents.filter(agent => agent.team?.enabled && agent.team.director_id === previous.director_id).map(agent => agent.id) : [];
    return withTeam(enabled, team, requesters, previous.director_id);
}
