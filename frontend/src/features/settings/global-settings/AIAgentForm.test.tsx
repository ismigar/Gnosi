import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AIAgentForm } from './AIAgentForm';
import type { AgentDraft, SettingsModel } from './types';
import { fetchAiCatalog } from '../../../shared/api/ai';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./AgentIconSelect', () => ({ AgentIconSelect: () => null }));
vi.mock('../../agent-context/AgentContextSources', () => ({ default: () => null }));
vi.mock('../AI/AIResourcesSettings', () => ({ AgentSkillsField: () => null }));
vi.mock('../AI/modelReliability', () => ({ MODEL_FAULT_REASONS: {}, findModelFault: () => null, useModelReliability: () => [] }));
vi.mock('../../../shared/api/ai', () => ({ fetchAiCatalog: vi.fn().mockResolvedValue({ config: { providers: {} } }), setAiProviderCredentials: vi.fn(), setAiProviderStatus: vi.fn() }));

const registry = [
  { provider: 'alpha', model_id: 'small', enabled: true, tags: ['tools'] },
  { provider: 'beta', model_id: 'large', enabled: true, tags: ['tools', 'code'] },
  { provider: 'beta', model_id: 'incompatible', enabled: true, tags: [] },
  { provider: 'beta', model_id: 'disabled', enabled: false, tags: ['tools'] },
  { provider: 'ollama', model_id: 'local', enabled: true, tags: ['tools'] },
] as SettingsModel[];
const agent: AgentDraft = { id: 'principal', name: 'Assistant', provider: 'alpha', model: 'small',
  persona: 'Keep these instructions', context: 'Reference context', skill_ids: ['research'] };
const onSave = vi.fn<(agent: AgentDraft) => Promise<void>>();
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  onSave.mockResolvedValue();
  vi.mocked(fetchAiCatalog).mockResolvedValue({ catalog: { providers: [] }, config: { providers: {} } });
});
afterEach(() => { act(() => { root.unmount(); }); host.remove(); vi.unstubAllGlobals(); });

function Harness({ draft = agent, models = registry, purpose = 'profile' }: { draft?: AgentDraft; models?: SettingsModel[]; purpose?: 'principal' | 'profile' }) {
  return <AIAgentForm agent={draft} purpose={purpose} aiRegistry={models} skills={[]} tools={[]} onSave={onSave} onChange={value => { void onSave(value); }} />;
}
function render(draft = agent, models = registry) {
  act(() => { root.render(<Harness draft={draft} models={models} />); });
}
function select(label: string, value: string) {
  const element = host.querySelector<HTMLSelectElement>(`select[aria-label="settings.ai.assistant.${label}"]`);
  if (!element) throw new Error(`Missing select: ${label}`);
  act(() => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent === text);
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => { button.click(); await Promise.resolve(); });
}

it('keeps legacy agents fixed and retains their instructions and capabilities on save', () => {
  render();
  expect(host.querySelector('select')?.value).toBe('alpha||small');
  expect(host.querySelector('[role="switch"]')).toBeNull();
  select('profile_model', 'alpha||small');
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ ...agent,
    model_strategy: { schema_version: 1, mode: 'pinned', decision_engine: 'rules', allowed_models: [] } }));
});

it('removes legacy model alternatives and saves exactly one selected LLM', () => {
  render({ ...agent, model_strategy: { schema_version: 1, mode: 'adaptive', decision_engine: 'jev', allowed_models: [{ provider: 'beta', model: 'large' }] } });
  expect(host.querySelectorAll('select')).toHaveLength(1);
  select('profile_model', 'ollama||local');
  expect(onSave.mock.calls[0]?.[0]).toMatchObject({ provider: 'ollama', model: 'local', model_strategy: { schema_version: 1, mode: 'pinned', decision_engine: 'rules', allowed_models: [] } });
});

it('does not save on mount or show a save button for existing profiles', () => {
  render();
  expect(onSave).not.toHaveBeenCalled();
  expect(host.querySelector('button[aria-pressed]')).not.toBeNull();
  expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent === 'save')).toBe(false);
});

it.each(['principal', 'profile'] as const)('distinguishes %s setup from an existing profile edit', async purpose => {
  const newProfile = { ...agent, id: undefined };
  act(() => { root.render(<Harness draft={newProfile} purpose={purpose} />); });
  expect(host.querySelector('h3')?.textContent).toBe(purpose === 'principal'
    ? 'settings.ai.assistant.setup' : 'settings.ai.assistant.new_profile');
  expect(host.textContent).toContain('settings.ai.assistant.profile_name');
  expect(host.textContent).not.toContain('settings.ai.new_agent_title');
  await click(purpose === 'principal' ? 'settings.ai.assistant.configure_action' : 'settings.ai.assistant.create_profile');
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: agent.name, model: agent.model }));
});

it('localizes a shipped profile name without persisting the translation on other edits', () => {
  render({ ...agent, name: 'Mail', managed_by: 'builtin:mail' });
  expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('settings.ai.assistant.builtin_profiles.mail');
  select('profile_model', 'beta||large');
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mail' }));
});
