import { expect, it } from 'vitest';
import { recommendedModelProfile } from './agentModelRecommendation';
import { EMPTY_TEAM, type AgentTeam } from './agentTeams';

it('recommends coordination for the explicit principal even when it belongs to a plugin', () => {
    expect(recommendedModelProfile({ id: 'mail', managed_by: 'builtin:mail' }, 'mail')).toBe('director');
});
it('distinguishes source research from structured mail work', () => {
    expect(recommendedModelProfile({ id: 'sources', managed_by: 'builtin:resources' }, 'brain')).toBe('documentalist');
    expect(recommendedModelProfile({ id: 'mail', managed_by: 'builtin:mail' }, 'brain')).toBe('administrative');
});
it('uses the most demanding assigned work, including customized copies of known skills', () => {
    const team: AgentTeam = { ...EMPTY_TEAM, members: [{ agent_id: 'mail', roles: ['worker', 'administrative'] }] };
    const profile = { id: 'mail', managed_by: 'builtin:mail', skill_ids: ['user.analysis'] };
    const catalog = [{ id: 'user.analysis', metadata: { derived_from: { id: 'core.gnosi-reader-topic-evolution' } } }];
    expect(recommendedModelProfile(profile, 'brain', team, catalog)).toBe('expert');
    expect(profile.skill_ids).toEqual(['user.analysis']);
});
it('updates its advice when team specialties or explicit task assignments change', () => {
    const team: AgentTeam = { ...EMPTY_TEAM, members: [{ agent_id: 'helper', roles: ['worker'] }] };
    expect(recommendedModelProfile({ id: 'helper' }, 'brain', team)).toBe('worker');
    team.direct_routes = [{ operation: 'notebook', agent_ids: ['helper'] }];
    expect(recommendedModelProfile({ id: 'helper' }, 'brain', team)).toBe('documentalist');
});
it('offers general guidance for unknown personal and external-plugin tasks without parsing their names', () => {
    expect(recommendedModelProfile({ id: 'Director by name', skill_ids: ['user.unknown'] }, 'brain')).toBe('allrounder');
    expect(recommendedModelProfile({ id: 'custom', managed_by: 'plugin:translation' }, 'brain')).toBe('allrounder');
    expect(recommendedModelProfile({ id: 'custom' }, 'brain', { enabled: false })).toBe('allrounder');
});
