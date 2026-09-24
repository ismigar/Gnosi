import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AIAgentForm } from './AIAgentForm';
import type { AgentDraft, SettingsModel } from './types';
import { fetchAiCatalog, setAiProviderCredentials, setAiProviderStatus } from '../../../shared/api/ai';

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
  const [connected, setConnected] = useState(false);
  return <AIAgentForm agent={draft} purpose={purpose} aiRegistry={models} skills={[]} tools={[]} onSave={onSave}
    jevConnected={connected} onConnectJev={() => { setConnected(true); }} />;
}
function render(draft = agent, models = registry) {
  act(() => { root.render(<Harness draft={draft} models={models} />); });
}
function select(label: string, value: string) {
  const element = host.querySelector<HTMLSelectElement>(`select[aria-label="settings.ai.model_strategy.${label}"]`);
  if (!element) throw new Error(`Missing select: ${label}`);
  act(() => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent === text);
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => { button.click(); await Promise.resolve(); });
}

function enterKey(value: string) {
  const field = host.querySelector<HTMLInputElement>('input[type="password"]');
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (!field || !descriptor?.set) throw new Error('Missing password input');
  act(() => {
    descriptor.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return field;
}

it('keeps legacy agents fixed and retains their instructions and capabilities on save', async () => {
  render();
  expect(host.querySelector('select')?.value).toBe('alpha||small');
  expect(host.querySelector('[role="switch"]')).toBeNull();
  await click('settings.ai.assistant.save_changes');
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ ...agent,
    model_strategy: { schema_version: 1, mode: 'pinned', decision_engine: 'rules', allowed_models: [] } }));
});

it('saves automatic selection only among explicitly enabled compatible models', async () => {
  render();
  select('label', 'adaptive');
  expect([...host.querySelectorAll('[role="switch"]')].map(item => item.getAttribute('aria-label'))).toEqual(['large · beta']);
  act(() => { host.querySelector<HTMLElement>('[role="switch"]')?.click(); });
  select('engine', 'jev');
  await click('settings.ai.assistant.save_changes');
  expect(onSave.mock.calls[0]?.[0].model_strategy).toEqual({ schema_version: 1, mode: 'adaptive',
    decision_engine: 'jev', allowed_models: [{ provider: 'beta', model: 'large' }] });
  expect(host.textContent).toContain('settings.ai.model_strategy.jev_help');
  expect(setAiProviderCredentials).not.toHaveBeenCalled();
});

it('resets remote routing when the primary is changed to a local model', async () => {
  render({ ...agent, model_strategy: { schema_version: 1, mode: 'adaptive', decision_engine: 'jev',
    allowed_models: [{ provider: 'beta', model: 'large' }] } });
  select('primary', 'ollama||local');
  expect(host.querySelector<HTMLOptionElement>('option[value="jev"]')?.disabled).toBe(true);
  expect(host.querySelector('input[type="password"]')).toBeNull();
  await click('settings.ai.assistant.save_changes');
  expect(onSave.mock.calls[0]?.[0].model_strategy).toEqual({ schema_version: 1, mode: 'adaptive', decision_engine: 'rules', allowed_models: [] });
});

it('does not allow saving an unavailable primary model', () => {
  render({ ...agent, model: 'removed' });
  const button = [...host.querySelectorAll('button')].find(item => item.textContent === 'settings.ai.assistant.save_changes');
  expect(button?.disabled).toBe(true);
});

it('connects TypeSafe explicitly and never saves the key in the assistant profile', async () => {
  render();
  select('label', 'adaptive'); select('engine', 'jev');
  const field = enterKey('test-only-key');
  await click('settings.ai.model_strategy.jev_connect');
  expect(setAiProviderCredentials).toHaveBeenCalledExactlyOnceWith('typesafe', { api_key: 'test-only-key', base_url: null });
  expect(setAiProviderStatus).toHaveBeenCalledExactlyOnceWith('typesafe', { enabled: true });
  expect(field.value).toBe('');
  expect(host.textContent).toContain('settings.ai.model_strategy.jev_connected');
  await click('settings.ai.assistant.save_changes');
  expect(JSON.stringify(onSave.mock.calls)).not.toContain('test-only-key');
});

it('shows connection and save failures without falsely marking success', async () => {
  vi.mocked(setAiProviderCredentials).mockRejectedValueOnce(new Error('test failure'));
  onSave.mockRejectedValueOnce(new Error('save failed'));
  render(); select('label', 'adaptive'); select('engine', 'jev');
  enterKey('test-only-key');
  await click('settings.ai.model_strategy.jev_connect');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('settings.ai.model_strategy.jev_connection_error');
  expect(setAiProviderStatus).not.toHaveBeenCalled();
  await click('settings.ai.assistant.save_changes');
  expect(host.textContent).toContain('settings.ai.model_strategy.save_error');
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
