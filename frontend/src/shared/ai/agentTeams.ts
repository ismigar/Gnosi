export const TEAM_ROLES = ['director', 'allrounder', 'documentalist', 'expert', 'administrative', 'worker'] as const;
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
        ...(agent.id === team.director_id ? { skill_ids: [...new Set([...(agent.skill_ids ?? []), TEAM_SKILL])] } : {}),
    }));
}

export function normalizedTeam(value: Partial<AgentTeam> | undefined, principalId: string): AgentTeam {
    return { ...EMPTY_TEAM, ...value, director_id: value?.director_id || principalId,
        members: value?.members ?? [], direct_routes: value?.direct_routes ?? [],
        temporary: { ...EMPTY_TEAM.temporary, ...value?.temporary },
    };
}
