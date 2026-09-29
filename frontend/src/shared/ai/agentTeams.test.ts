import { describe, expect, it } from 'vitest';
import { withTeam, normalizedTeam, changeTeamPrincipal, EMPTY_TEAM, TEAM_SKILL, type AgentTeam } from './agentTeams';

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
    it('is disabled until a receiving member is configured', () => {
        expect(EMPTY_TEAM.enabled).toBe(false);
        expect(EMPTY_TEAM.temporary.enabled).toBe(false);
    });
    it('does not add skills when saving an inactive team', () => {
        const agent = { id: 'd', skill_ids: ['read'] };
        expect(withTeam([agent], { ...EMPTY_TEAM, director_id: 'd' }, [])[0]?.skill_ids).toEqual(['read']);
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

it('moves coordination without making the new principal receive its own assignments', () => {
    const team: AgentTeam = { ...EMPTY_TEAM, enabled: true, director_id: 'old', members: [{ agent_id: 'new', roles: ['expert'] }, { agent_id: 'worker', roles: ['worker'] }], direct_routes: [{ operation: 'writing', agent_ids: ['new', 'worker'] }] };
    const agents = [{ id: 'old', team }, { id: 'new', skill_ids: ['mail'] }, { id: 'worker' }];
    const changed = changeTeamPrincipal(agents, 'new', 'old');
    expect(changed[1]?.team).toMatchObject({ enabled: true, director_id: 'new', members: [{ agent_id: 'worker', roles: ['worker'] }], direct_routes: [{ operation: 'writing', agent_ids: ['worker'] }] });
    expect(changed[1]?.skill_ids).toEqual(['mail', TEAM_SKILL]);
    expect(changed[0]?.team?.director_id).toBe('new');
});
it('keeps an inactive team inactive when choosing another principal', () => {
    const team: AgentTeam = { ...EMPTY_TEAM, director_id: 'old', members: [{ agent_id: 'worker', roles: ['worker'] }] };
    const changed = changeTeamPrincipal([{ id: 'old', team }, { id: 'new', skill_ids: ['read'] }, { id: 'worker' }], 'new', 'old');
    expect(changed[1]?.team?.enabled).toBe(false);
    expect(changed[1]?.skill_ids).toEqual(['read']);
    const legacy = changeTeamPrincipal([{ id: 'old', team: { enabled: false } as AgentTeam }, { id: 'new' }], 'new', 'old');
    expect(legacy[1]?.team).toMatchObject({ enabled: false, director_id: 'new', members: [], direct_routes: [] });
});
