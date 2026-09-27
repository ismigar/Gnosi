import { act, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentsPanel } from './AgentsPanel';
import type { AgentDraft, SettingsAgent } from './types';
import { EMPTY_TEAM, TEAM_SKILL, type AgentTeam } from '../../../shared/ai/agentTeams';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { resolvedLanguage: 'ca' }, t: (key: string, values?: { name?: string }) => values?.name ? `${key}:${values.name}` : key }) }));
vi.mock('./AIAgentForm', () => ({
  AIAgentForm: ({ agent, purpose, onSave, onChange }: { onChange: (value: AgentDraft) => void; agent: AgentDraft; purpose: string; onSave: (value: AgentDraft) => Promise<void> }) => <div data-purpose={purpose}>
    <input aria-label="Profile name" defaultValue={agent.name || ''} />
    <button onClick={() => { onChange({ ...agent, name: "Auto saved" }); }}>Edit fixture</button>
    <button onClick={() => { void onSave({ ...agent, name: agent.name || 'New profile', model: 'test' }); }}>Save fixture</button>
  </div>,
}));
vi.mock('../../../shared/ui/previews/IconRenderer', () => ({ IconRenderer: () => null }));
let host: HTMLDivElement;
let root: Root;
const principal = { id: 'brain', name: 'Cervell', model: 'test', enabled: true };
const deleteProfile = vi.fn();
function Harness({ editing = false, empty = false, profiles, activeId, onOpenActivity, focusedProfileId }: { focusedProfileId?: string; editing?: boolean; empty?: boolean; profiles?: SettingsAgent[]; activeId?: string; onOpenActivity?: () => void }) {
  const [editingAgent, setEditingAgent] = useState<AgentDraft | null>(editing ? principal : null);
  const [agentEditorTarget, setAgentEditorTarget] = useState<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState({ ai: { agents: profiles || (empty ? [] : [principal]), active_agent_id: activeId ?? (empty ? '' : principal.id), providers: {} } });
  const context = {
    draft, setDraft, handleDeleteAIAgent: deleteProfile,
    editingAgent, setEditingAgent, agentEditorTarget, setAgentEditorTarget,
    aiRegistry: [], aiResources: { skills: [], tools: [], assignAgentSkills: (_id: string, ids: string[]) => Promise.resolve(ids) },
    t: (key: string, values?: { name?: string }) => values?.name ? `${key}:${values.name}` : key, tn: (key: string) => key,
  } as unknown as ComponentProps<typeof AgentsPanel>['context'];
  return <><AgentsPanel focusedProfileId={focusedProfileId} context={context} onOpenActivity={onOpenActivity} /><output>{JSON.stringify(draft.ai)}</output></>;
}
function click(key: string) {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent === key);
  expect(button).toBeDefined();
  act(() => { button?.click(); });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => { act(() => { root.unmount(); }); vi.unstubAllGlobals(); });
it.each([false, true])('opens an empty creation form with principal editing=%s', editing => {
  act(() => { root.render(<Harness editing={editing} />); });
  click('settings.ai.assistant.create_profile');
  expect(host.querySelector('[data-settings-editor-for="agent:new"]')).not.toBeNull();
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Profile name"]')?.value).toBe('');
  expect(host.querySelector('[data-settings-editor-for="agent:brain"]')).toBeNull();
  click('common.cancel');
  expect(host.querySelector('[data-settings-editor-for="agent:new"]')).toBeNull();
  expect(host.textContent).toContain('Cervell');
  click('settings.ai.assistant.create_profile');
  expect(host.querySelector('[data-settings-editor-for="agent:new"]')).not.toBeNull();
});

it('keeps first-time setup focused and allows cancellation and activity navigation', () => {
  const onOpenActivity = vi.fn();
  act(() => { root.render(<Harness empty onOpenActivity={onOpenActivity} />); });
  expect(host.textContent).not.toContain('settings.ai.assistant.advanced');
  click('settings.ai.assistant.setup');
  expect(host.querySelector('[data-settings-editor-for="agent:new"]')).not.toBeNull();
  expect(host.textContent).not.toContain('settings.ai.assistant.profiles_help');
  click('common.cancel');
  expect(host.querySelector('[data-settings-editor-for="agent:new"]')).toBeNull();
  click('activity.open_activity');
  expect(onOpenActivity).toHaveBeenCalledOnce();
});

function savedAi() {
  return JSON.parse(host.querySelector('output')?.textContent || '{}') as { active_agent_id: string; agents: SettingsAgent[] };
}

it('shows every profile once and protects the selected principal from deletion', () => {
  act(() => { root.render(<Harness profiles={[principal, { id: 'other', name: 'Other' }]} />); });
  expect(host.querySelectorAll('[data-settings-item-id="agent:brain"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-settings-item-id="agent:other"]')).toHaveLength(1);
  expect(host.querySelectorAll('[aria-label^="settings.ai.assistant.delete_profile"]')).toHaveLength(1);
  const rows = host.querySelectorAll('.ai-agent-row');
  expect(rows[0]?.textContent).toContain('settings.ai.assistant.principal_profile');
  expect(rows[1]?.textContent).toContain('settings.ai.assistant.additional_profile');
  act(() => { host.querySelector<HTMLButtonElement>('[aria-label="settings.ai.assistant.delete_profile:Other"]')?.click(); });
  expect(deleteProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 'other' }));
});

it('configures and enables the first profile as principal', async () => {
  act(() => { root.render(<Harness empty />); });
  click('settings.ai.assistant.setup');
  expect(host.querySelector('[data-purpose]')?.getAttribute('data-purpose')).toBe('principal');
  await act(async () => { click('Save fixture'); await Promise.resolve(); });
  const ai = savedAi();
  expect(ai.agents).toHaveLength(1);
  expect(ai.agents[0]).toMatchObject({ id: ai.active_agent_id, enabled: true });
});

it('creates a saved profile without replacing the principal', async () => {
  act(() => { root.render(<Harness />); });
  click('settings.ai.assistant.create_profile');
  expect(host.querySelector('[data-purpose]')?.getAttribute('data-purpose')).toBe('profile');
  await act(async () => { click('Save fixture'); await Promise.resolve(); });
  expect(savedAi().active_agent_id).toBe(principal.id);
  expect(savedAi().agents).toHaveLength(2);
});

it.each([principal.id, 'missing'])('can adopt a previously disabled profile with principal=%s', activeId => {
  const alternate = { id: 'other', name: 'Other', enabled: false, persona: 'Keep instructions', skill_ids: ['research'], extension: { keep: true } };
  act(() => { root.render(<Harness profiles={[principal, alternate]} activeId={activeId} />); });
  const row = host.querySelector('[data-settings-item-id="agent:other"]');
  const useProfile = [...(row?.querySelectorAll('button') || [])].find(button => button.textContent === 'settings.ai.assistant.make_principal');
  act(() => { useProfile?.click(); });
  expect(savedAi().active_agent_id).toBe('other');
  expect(savedAi().agents[1]).toEqual({ ...alternate, enabled: true });
  expect(host.querySelector('[data-settings-item-id="agent:other"] [aria-label^="settings.ai.assistant.delete_profile"]')).toBeNull();
  expect(savedAi().agents[0]).toEqual(principal);
});

it('restores a disabled principal through an explicit action', () => {
  act(() => { root.render(<Harness profiles={[{ ...principal, enabled: false }]} />); });
  expect(host.querySelector('[role="status"]')?.textContent).toBe('settings.ai.assistant.restore_help');
  click('settings.ai.assistant.make_principal');
  expect(savedAi().agents[0]?.enabled).toBe(true);
  expect(host.querySelector('[role="status"]')).toBeNull();
});


it('shows editable plugin profiles in the same list without implicitly making them principal', async () => {
  const plugin = { id: 'builtin.mail.default', name: 'Mail profile', managed_by: 'builtin:mail', model: 'mail-model' };
  act(() => { root.render(<Harness profiles={[principal, plugin]} />); });
  const section = host.querySelector('[data-settings-item-id="agent:builtin.mail.default"]');
  expect(section?.textContent).toContain('Mail profile');
  expect(section?.textContent).toContain('settings.ai.assistant.plugin_profile');
  expect(section?.querySelector('[aria-label^="settings.ai.assistant.delete_profile"]')).toBeNull();
  act(() => { section?.querySelector<HTMLButtonElement>('[aria-label^="settings.ai.assistant.configure_profile"]')?.click(); });
  expect(host.querySelector('[data-purpose="profile"]')).not.toBeNull();
  const save = [...host.querySelectorAll('button')].find(button => button.textContent === 'Save fixture');
  await act(async () => { save?.click(); await Promise.resolve(); });
  expect(savedAi().active_agent_id).toBe(principal.id);
  expect(savedAi().agents.find(agent => agent.id === plugin.id)?.managed_by).toBe('builtin:mail');
});

it('toggles profile editors and keeps only one open across personal and plugin profiles', () => {
  const plugin = { id: 'builtin.mail.default', name: 'Mail profile', managed_by: 'builtin:mail' };
  act(() => { root.render(<Harness profiles={[principal, plugin]} />); });
  const toggle = (name: string) => { act(() => { host.querySelector<HTMLButtonElement>(`[aria-label="settings.ai.assistant.configure_profile:${name}"]`)?.click(); }); };
  toggle('Cervell');
  expect(host.querySelectorAll('[data-settings-editor-for]')).toHaveLength(1);
  toggle('Mail profile');
  expect(host.querySelector('[data-settings-editor-for="agent:brain"]')).toBeNull();
  expect(host.querySelectorAll('[data-settings-editor-for]')).toHaveLength(1);
  toggle('Mail profile');
  expect(host.querySelector('[data-settings-editor-for]')).toBeNull();
});

it('puts profile edits into the settings autosave draft before collapsing', () => {
  act(() => { root.render(<Harness editing />); });
  click('Edit fixture');
  expect(savedAi().agents[0]?.name).toBe('Auto saved');
  act(() => { host.querySelector<HTMLButtonElement>('[aria-expanded="true"][aria-label^="settings.ai.assistant.configure_profile"]')?.click(); });
  expect(host.querySelector('[data-settings-editor-for]')).toBeNull();
  expect(savedAi().agents[0]?.name).toBe('Auto saved');
});

it('shows only the assigned profile when opened from a plugin', () => {
  act(() => { root.render(<Harness editing focusedProfileId="brain" profiles={[principal, { ...principal, id: 'other', name: 'Other' }]} />); });
  expect(host.querySelector('[data-settings-item-id="agent:brain"]')).not.toBeNull();
  expect(host.querySelector('[data-settings-item-id="agent:other"]')).toBeNull();
  expect(host.querySelector('[data-settings-editor-for="agent:brain"]')).not.toBeNull();
  expect(host.textContent).not.toContain('settings.ai.assistant.advanced');
});

it('organizes personal and plugin assistants in one editable card each without duplicate lists', () => {
  const plugin = { id: 'mail', name: 'Mail helper', managed_by: 'builtin:mail', model: 'mail-model', persona: 'Keep mail instructions' };
  act(() => { root.render(<Harness profiles={[principal, { id: 'other', name: 'Other' }, plugin]} />); });
  for (const id of ['brain', 'other', 'mail']) {
    expect(host.querySelectorAll(`[data-settings-item-id="agent:${id}"]`)).toHaveLength(1);
  }
  expect(host.querySelector('section[aria-label="settings.ai.assistant.plugin_profiles"]')).toBeNull();
  expect(host.textContent).not.toContain('agent_team.entrypoints');
  expect(host.textContent).not.toContain('settings.ai.assistant.advanced');
  const card = host.querySelector('[data-settings-item-id="agent:mail"]')?.closest('.agent-team-setup__card');
  const participation = card?.querySelector<HTMLSelectElement>('.agent-team-setup__participation select');
  expect(participation).toBeTruthy();
  act(() => { card?.querySelector<HTMLButtonElement>('[aria-label="settings.ai.assistant.configure_profile:Mail helper"]')?.click(); });
  expect(card?.querySelector('[data-settings-editor-for="agent:mail"]')).not.toBeNull();
  act(() => { if (participation) { participation.value = 'both'; participation.dispatchEvent(new Event('change', { bubbles: true })); } });
  expect(savedAi().agents.find(agent => agent.id === 'mail')?.team?.enabled).toBe(true);
  click('Edit fixture');
  const ai = savedAi();
  expect(ai.agents.find(agent => agent.id === 'mail')).toMatchObject({ ...plugin, name: 'Auto saved', team: { enabled: true, director_id: 'brain' } });
  expect(ai.agents.find(agent => agent.id === 'brain')?.team?.members).toEqual([{ agent_id: 'mail', roles: ['allrounder'] }]);
  click('common.close');
  expect(host.querySelector('[data-settings-editor-for]')).toBeNull();
  expect(host.querySelectorAll('[data-settings-item-id="agent:mail"]')).toHaveLength(1);
});

it('preserves autosaved team settings and coordination while an older director editor remains open', async () => {
  act(() => { root.render(<Harness profiles={[principal, { id: 'other', name: 'Other' }]} />); });
  act(() => { host.querySelector<HTMLButtonElement>('[aria-label="settings.ai.assistant.configure_profile:Cervell"]')?.click(); });
  const participation = host.querySelector<HTMLSelectElement>('[aria-label="agent_team.participation_for:Other"]');
  expect(participation).not.toBeNull();
  act(() => { if (participation) { participation.value = 'member'; participation.dispatchEvent(new Event('change', { bubbles: true })); } });
  click('Edit fixture');
  expect(savedAi().agents[0]).toMatchObject({ name: 'Auto saved', skill_ids: [TEAM_SKILL], team: { enabled: true, members: [{ agent_id: 'other', roles: ['allrounder'] }] } });
  await act(async () => { click('Save fixture'); await Promise.resolve(); });
  expect(savedAi().agents[0]).toMatchObject({ skill_ids: [TEAM_SKILL], team: { enabled: true, members: [{ agent_id: 'other', roles: ['allrounder'] }] } });
});

it('selects a plugin bot as the only principal from its card and transfers the existing team', () => {
  const team: AgentTeam = { ...EMPTY_TEAM, enabled: true, director_id: principal.id, members: [{ agent_id: 'helper', roles: ['allrounder'] }] };
  const plugin = { id: 'mail', name: 'Mail helper', managed_by: 'builtin:mail', persona: 'Keep instructions', skill_ids: ['mail'] };
  act(() => { root.render(<Harness profiles={[{ ...principal, team }, plugin, { id: 'helper', name: 'Helper' }]} />); });
  act(() => { host.querySelector<HTMLButtonElement>('[aria-label="settings.ai.assistant.configure_profile:Cervell"]')?.click(); });
  click('Edit fixture');
  act(() => { host.querySelector<HTMLButtonElement>('[aria-label="settings.ai.assistant.make_principal_for:Mail helper"]')?.click(); });
  expect(savedAi().active_agent_id).toBe('mail');
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Profile name"]')?.value).toBe('Auto saved');
  expect(savedAi().agents.find(agent => agent.id === principal.id)?.name).toBe('Auto saved');
  expect(savedAi().agents.find(agent => agent.id === 'mail')).toMatchObject({ ...plugin, skill_ids: ['mail', TEAM_SKILL], team: { enabled: true, director_id: 'mail', members: team.members } });
  const cards = [...host.querySelectorAll('[data-settings-item-id]')];
  expect(cards).toHaveLength(3);
  expect(cards.filter(card => card.textContent.includes('settings.ai.assistant.principal_profile'))).toHaveLength(1);
  expect(cards[0]?.getAttribute('data-settings-item-id')).toBe('agent:mail');
  expect(host.textContent).not.toContain('agent_team.setup');
  expect(host.querySelector('[aria-label="agent_team.director"]')).toBeNull();
});
