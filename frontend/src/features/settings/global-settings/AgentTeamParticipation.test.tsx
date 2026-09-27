import { act } from 'react';
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
function render(profiles: SettingsAgent[]) {
    act(() => { root.render(<AgentTeamSetup agents={profiles} principalId="d" registry={[]} onApply={apply} />); });
    click('agent_team.setup');
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
function updated() { return apply.mock.calls[0]?.[0] as SettingsAgent[]; }
it.each([
    ['independent', false, false], ['member', true, false], ['requester', false, true], ['both', true, true],
] as const)('maps %s to the existing receiving and requesting permissions', (participation, member, requester) => {
    render([{ ...director, team: savedTeam }, worker, { id: 'p', name: 'plugin', managed_by: 'builtin:mail', persona: 'Keep plugin instructions' }]);
    select('plugin', participation);
    click('agent_team.apply');
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
    click('agent_team.apply');
    expect(updated()).toEqual(profiles);
});
it('keeps specialties and direct assignments when a member also starts requesting help', () => {
    render([{ ...director, team: savedTeam }, worker]);
    select('worker', 'both');
    click('agent_team.apply');
    expect(updated()[0]?.team).toEqual(savedTeam);
    expect(updated()[1]?.team).toEqual(savedTeam);
});
it('removes only a former member’s assignments and revokes its requests when made independent', () => {
    const team: AgentTeam = { ...savedTeam, members: [...savedTeam.members, { agent_id: 'p', roles: ['expert'] }], direct_routes: [{ operation: 'writing', agent_ids: ['w', 'p'] }, { operation: 'reader', agent_ids: ['w'] }] };
    render([{ ...director, team }, { ...worker, team }, { id: 'p', name: 'helper' }]);
    select('worker', 'independent');
    click('agent_team.apply');
    expect(updated()[0]?.team?.members).toEqual([{ agent_id: 'p', roles: ['expert'] }]);
    expect(updated()[0]?.team?.direct_routes).toEqual([{ operation: 'writing', agent_ids: ['p'] }]);
    expect(updated()[1]?.team?.enabled).toBe(false);
});
it('cancelling discards participation changes and reopens the saved configuration', () => {
    render([director, worker]);
    select('worker', 'both');
    click('common.cancel');
    expect(apply).not.toHaveBeenCalled();
    click('agent_team.setup');
    expect(host.querySelector<HTMLSelectElement>('[aria-label="agent_team.participation_for:worker"]')?.value).toBe('independent');
});
it('keeps unavailable assistants visible without offering new team permissions', () => {
    render([director, worker, { id: 'disabled', name: 'disabled', enabled: false }, { id: 'suspended', name: 'suspended', managed_by: 'builtin:mail', plugin_suspended: true }]);
    for (const name of ['disabled', 'suspended']) {
        expect(host.querySelector<HTMLSelectElement>(`[aria-label="agent_team.participation_for:${name}"]`)?.disabled).toBe(true);
    }
    expect(host.querySelectorAll('.agent-team-setup__card')).toHaveLength(4);
    expect(host.querySelector<HTMLButtonElement>('button.btn-gnosi-primary')?.disabled).toBe(true);
});
it('requires members even if other profiles can request help', () => {
    render([director, worker]);
    select('worker', 'requester');
    click('agent_team.apply');
    expect(apply).not.toHaveBeenCalled();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('agent_team.members_required');
});
it('explains an incomplete temporary policy even while advanced settings are collapsed', () => {
    render([{ ...director, team: { ...savedTeam, temporary: { enabled: true, models: [], skill_ids: [] } } }, worker]);
    expect(host.querySelector<HTMLDetailsElement>('.agent-team-setup__advanced')?.open).toBe(false);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('agent_team.temporary_required');
    click('agent_team.apply');
    expect(apply).not.toHaveBeenCalled();
});
it('disables the team without disabling assistants or erasing their saved settings', () => {
    const profiles = [{ ...director, team: savedTeam }, { ...worker, team: savedTeam }];
    render(profiles);
    click('agent_team.disable');
    expect(updated()).toEqual(profiles.map(profile => ({ ...profile, team: { ...savedTeam, enabled: false } })));
});
