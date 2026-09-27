import { describe, expect, it } from 'vitest';
import { withTeam, normalizedTeam, EMPTY_TEAM, TEAM_SKILL, type AgentTeam } from './agentTeams';

describe('team configuration', () => {
    it('adds coordination only to the director and preserves fixed models and custom instructions', () => {
        const agents = [{ id: 'd', model: 'strong', persona: 'Mine', skill_ids: ['read'] }, { id: 'w', model: 'small', persona: 'Write carefully', skill_ids: ['write'] }, { id: 'p', model: 'plugin', persona: 'Plugin procedure', skill_ids: ['plugin'] }];
        const team: AgentTeam = { ...EMPTY_TEAM, enabled: true, director_id: 'd', members: [{ agent_id: 'w', roles: ['worker', 'administrative'] }] };
        const result = withTeam(agents, team, ['p']);
        expect(result[0]).toEqual({ ...agents[0], team, skill_ids: ['read', TEAM_SKILL] });
        expect(result[1]).toEqual(agents[1]);
        expect(result[2]).toEqual({ ...agents[2], team });
        expect(agents[0]?.skill_ids).toEqual(['read']);
    });
    it('is disabled until configuration is explicitly applied', () => {
        expect(EMPTY_TEAM.enabled).toBe(false);
        expect(EMPTY_TEAM.temporary.enabled).toBe(false);
    });
});

it('revokes deselected initiators while preserving unrelated teams', () => {
    const team: AgentTeam = { ...EMPTY_TEAM, enabled: true, director_id: 'd' };
    const unrelated: AgentTeam = { ...team, director_id: 'other' };
    const agents = [{ id: 'd' }, { id: 'plugin', team }, { id: 'unrelated', team: unrelated }];
    const updated = withTeam(agents, team, []);
    expect(updated[1]?.team?.enabled).toBe(false);
    expect(updated[2]?.team).toEqual(unrelated);
});

it('opens minimal disabled configurations without implicitly enabling them', () => {
    expect(normalizedTeam({ enabled: false }, 'new')).toEqual({ ...EMPTY_TEAM, director_id: 'new' });
});
