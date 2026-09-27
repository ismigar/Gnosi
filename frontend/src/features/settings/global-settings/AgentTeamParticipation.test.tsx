import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentTeamSetup } from './AgentTeamSetup';
import { EMPTY_TEAM, TEAM_SKILL, type AgentTeam } from '../../../shared/ai/agentTeams';
import type { SettingsAgent } from './types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { resolvedLanguage: 'ca' }, t: (key: string, values?: { name?: string }) => values?.name ? `${key}:${values.name}` : key }) }));
let host: HTMLDivElement;
let root: Root;
const apply = vi.fn();
const director: SettingsAgent = { id: 'd', name: 'director', model: 'large', persona: 'Original', skill_ids: ['read', TEAM_SKILL] };
const worker: SettingsAgent = { id: 'w', name: 'worker', model: 'small', persona: 'Keep', skill_ids: ['write'] };
const savedTeam: AgentTeam = { ...EMPTY_TEAM, enabled: true, director_id: 'd', members: [{ agent_id: 'w', roles: ['worker', 'expert'] }], direct_routes: [{ operation: 'writing', agent_ids: ['w'] }] };
beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div'); root = createRoot(host);
});
afterEach(() => { act(() => { root.unmount(); }); vi.unstubAllGlobals(); });
function Harness({ profiles }: { profiles: SettingsAgent[] }) {
    const [agents, setAgents] = useState(profiles);
    const [visible, setVisible] = useState(true);
    const [principalId, setPrincipalId] = useState('d');
    return <><button onClick={() => { setVisible(!visible); }}>{visible ? 'fixture.close' : 'fixture.open'}</button>{visible && <AgentTeamSetup agents={agents} principalId={principalId} registry={[{ provider: 'test', model_id: 'small', enabled: true }, { provider: 'test', model_id: 'large', enabled: true }]} onChange={(next, id) => { apply(next, id); setAgents(next); setPrincipalId(id); }} />}</>;
}
function render(profiles: SettingsAgent[]) {
    act(() => { root.render(<Harness profiles={profiles} />); });
}
function click(text: string) {
    const button = [...host.querySelectorAll('button')].find(item => item.textContent === text);
    expect(button).toBeDefined(); act(() => { button?.click(); });
}
function select(name: string, value: string) {
    const field = host.querySelector<HTMLSelectElement>(`select[aria-label="agent_team.participation_for:${name}"]`);
    expect(field).not.toBeNull();
    act(() => { if (field) { field.value = value; field.dispatchEvent(new Event('change', { bubbles: true })); } });
}
function updated() { return apply.mock.calls.at(-1)?.[0] as SettingsAgent[]; }
it.each([
    ['independent', false, false], ['member', true, false], ['requester', false, true], ['both', true, true],
] as const)('maps %s to the existing receiving and requesting permissions', (participation, member, requester) => {
    render([{ ...director, team: savedTeam }, worker, { id: 'p', name: 'plugin', managed_by: 'builtin:mail', persona: 'Keep plugin instructions' }]);
    select('plugin', participation);
    const result = updated();
    expect(result[0]?.team?.members.some(m => m.agent_id === 'p')).toBe(member);
    expect(result[2]?.team?.enabled === true).toBe(requester);
    expect(result[2]).toMatchObject({ managed_by: 'builtin:mail', persona: 'Keep plugin instructions' });
});
it('restores all four saved participation states without changing permissions or role order', () => {
    const team: AgentTeam = { ...savedTeam, members: [...savedTeam.members, { agent_id: 'b', roles: ['administrative'] }] };
    const profiles = [{ ...director, team }, worker, { id: 'p', name: 'requester', team }, { id: 'b', name: 'both', team }, { id: 'i', name: 'independent' }];
    render(profiles);
    for (const [name, value] of [['worker', 'member'], ['requester', 'requester'], ['both', 'both'], ['independent', 'independent']] as const) {
        expect(host.querySelector<HTMLSelectElement>(`[aria-label="agent_team.participation_for:${name}"]`)?.value).toBe(value);
    }
    expect(apply).not.toHaveBeenCalled();
});
it('keeps specialties and direct assignments when a member also starts requesting help', () => {
    render([{ ...director, team: savedTeam }, worker]);
    select('worker', 'both');
    expect(updated()[0]?.team).toEqual(savedTeam);
    expect(updated()[1]?.team).toEqual(savedTeam);
});
it('removes only a former member’s assignments and revokes its requests when made independent', () => {
    const team: AgentTeam = { ...savedTeam, members: [...savedTeam.members, { agent_id: 'p', roles: ['expert'] }], direct_routes: [{ operation: 'writing', agent_ids: ['w', 'p'] }, { operation: 'reader', agent_ids: ['w'] }] };
    render([{ ...director, team }, { ...worker, team }, { id: 'p', name: 'helper' }]);
    select('worker', 'independent');
    expect(updated()[0]?.team?.members).toEqual([{ agent_id: 'p', roles: ['expert'] }]);
    expect(updated()[0]?.team?.direct_routes).toEqual([{ operation: 'writing', agent_ids: ['p'] }]);
    expect(updated()[1]?.team?.enabled).toBe(false);
});
it('closing retains autosaved participation and reopens the saved configuration', () => {
    render([director, worker]);
    select('worker', 'both');
    click('fixture.close');
    expect(apply).toHaveBeenCalledOnce();
    click('fixture.open');
    expect(host.querySelector<HTMLSelectElement>('[aria-label="agent_team.participation_for:worker"]')?.value).toBe('both');
});
it('hides suspended plugin assistants while retaining disabled personal profiles', () => {
    render([director, worker, { id: 'disabled', name: 'disabled', enabled: false }, { id: 'suspended', name: 'suspended', managed_by: 'builtin:mail', plugin_suspended: true }]);
    expect(host.querySelector<HTMLSelectElement>('[aria-label="agent_team.participation_for:disabled"]')?.disabled).toBe(true);
    expect(host.querySelector('[aria-label="agent_team.participation_for:suspended"]')).toBeNull();
    expect(host.querySelectorAll('.agent-team-setup__card')).toHaveLength(3);
    expect(apply).not.toHaveBeenCalled();
});
it('requires members even if other profiles can request help', () => {
    render([director, worker]);
    select('worker', 'requester');
    expect(apply).not.toHaveBeenCalled();
    expect(host.textContent).toContain('agent_team.pending_changes');
    expect(host.textContent).toContain('agent_team.members_required');
});
it('autosaves a pending requester once a receiving assistant is chosen', () => {
    render([director, worker, { id: 'p', name: 'helper' }]);
    select('worker', 'requester');
    expect(apply).not.toHaveBeenCalled();
    select('helper', 'member');
    expect(apply).toHaveBeenCalledOnce();
    expect(updated()[0]?.team?.members).toEqual([{ agent_id: 'p', roles: ['allrounder'] }]);
    expect(updated()[1]?.team?.enabled).toBe(true);
    expect(host.textContent).not.toContain('agent_team.pending_changes');
});
it('removing the last member disables requests and clears assignments while preserving unrelated teams', () => {
    const unrelated = { ...savedTeam, director_id: 'other' };
    render([{ ...director, team: savedTeam }, { ...worker, team: savedTeam }, { id: 'p', name: 'requester', team: savedTeam }, { id: 'other', name: 'other', team: unrelated }]);
    select('worker', 'independent');
    expect(updated()[0]?.team).toMatchObject({ enabled: false, members: [], direct_routes: [] });
    expect(updated()[1]?.team?.enabled).toBe(false);
    expect(updated()[2]?.team?.enabled).toBe(false);
    expect(updated()[3]?.team).toEqual(unrelated);
    click('fixture.close');
    click('fixture.open');
    expect(host.querySelector<HTMLSelectElement>('[aria-label="agent_team.participation_for:requester"]')?.value).toBe('independent');
});
it('replaces empty task selectors with guidance on adding receivers', () => {
    render([director, worker]);
    expect(host.textContent).toContain('agent_team.routes_empty');
    expect(host.querySelector('select[multiple]')).toBeNull();
    expect(host.querySelector('.agent-team-setup__route')).toBeNull();
});
it('autosaves named task switches and restores Director coordination when all are off', () => {
    render([{ ...director, team: savedTeam }, worker]);
    const group = host.querySelector('[role="group"][aria-label="agent_execution.skills.writing"]');
    const toggle = group?.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    act(() => { toggle?.click(); });
    expect(updated()[0]?.team?.direct_routes).toEqual([]);
    expect(group?.closest('details')?.querySelector('summary')?.textContent).toContain('agent_team.route_automatic');
    act(() => { toggle?.click(); });
    expect(updated()[0]?.team?.direct_routes).toEqual(savedTeam.direct_routes);
});
it('autosaves specialty changes without losing other roles or assignments', () => {
    render([{ ...director, team: savedTeam }, worker]);
    act(() => { host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="worker: model_comparison.profiles.expert"]')?.click(); });
    expect(updated()[0]?.team?.members[0]?.roles).toEqual(['worker']);
    expect(updated()[0]?.team?.direct_routes).toEqual(savedTeam.direct_routes);
});
it('keeps incomplete temporary permissions out of autosave until both allowlists are complete', () => {
    render([{ ...director, team: savedTeam }, worker]);
    act(() => { host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="agent_team.temporary"]')?.click(); });
    expect(host.textContent).toContain('agent_team.pending_changes');
    const toggle = (group: string) => { act(() => { host.querySelector<HTMLButtonElement>(`[role="group"][aria-label="${group}"] [role="switch"]`)?.click(); }); };
    toggle('agent_team.allowed_models');
    expect(apply).not.toHaveBeenCalled();
    toggle('agent_team.allowed_skills');
    expect(apply).toHaveBeenCalledOnce();
    expect(updated()[0]?.team?.temporary).toEqual({ enabled: true, models: [{ provider: 'test', model: 'small' }], skill_ids: ['read'] });
    expect(host.textContent).not.toContain('agent_team.pending_changes');
    for (const group of ['agent_team.allowed_models', 'agent_team.allowed_skills']) {
        act(() => { host.querySelectorAll<HTMLButtonElement>(`[role="group"][aria-label="${group}"] [role="switch"]`)[1]?.click(); });
    }
    expect(updated()[0]?.team?.temporary).toEqual({ enabled: true, models: [{ provider: 'test', model: 'small' }, { provider: 'test', model: 'large' }], skill_ids: ['read', 'write'] });
});
it('explains an incomplete temporary policy even while advanced settings are collapsed', () => {
    render([{ ...director, team: { ...savedTeam, temporary: { enabled: true, models: [], skill_ids: [] } } }, worker]);
    expect(host.querySelector<HTMLDetailsElement>('.agent-team-setup__advanced')?.open).toBe(false);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('agent_team.temporary_required');
    expect(apply).not.toHaveBeenCalled();
});
it('disables the team without disabling assistants or erasing their saved settings', () => {
    const profiles = [{ ...director, team: savedTeam }, { ...worker, team: savedTeam }];
    render(profiles);
    click('agent_team.disable');
    expect(updated()).toEqual(profiles.map(profile => ({ ...profile, team: { ...savedTeam, enabled: false } })));
});
