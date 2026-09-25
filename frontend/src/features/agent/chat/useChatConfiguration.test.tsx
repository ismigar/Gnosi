import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchAiModelComparison } from '../../../shared/api/ai';
import { fetchConfiguration } from '../../../shared/api/configuration';
import { useChatConfiguration } from './useChatConfiguration';

vi.mock('../../../shared/api/ai', () => ({ fetchAiModelComparison: vi.fn().mockResolvedValue({ models: [] }) }));
vi.mock('../../../shared/api/configuration', () => ({ fetchConfiguration: vi.fn() }));
vi.mock('../../../shared/platform/configEvents', () => ({ useConfigChanged: () => undefined }));
let host: HTMLDivElement;
let root: Root;
const profiles = [{ id: 'other', name: 'Saved profile' }, { id: 'principal', name: 'Principal', model: 'model' }];

function Harness({ initial = 'other' }: { initial?: string }) {
  const [selectedAgentId, setSelectedAgentId] = useState(initial);
  const { agentConfig, agentList, loadConfig } = useChatConfiguration({ selectedAgentId, setSelectedAgentId });
  useEffect(() => { void loadConfig(); }, [loadConfig]);
  return <>
    <output>{JSON.stringify({ agentConfig, agentList, selectedAgentId })}</output>
    <button onClick={() => { void loadConfig(); }}>Reload</button>
  </>;
}
function current() {
  return JSON.parse(host.querySelector('output')?.textContent || '{}') as {
    agentConfig: { id: string } | null; agentList: { id: string; modelProfile?: string }[]; selectedAgentId: string;
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchAiModelComparison).mockResolvedValue({ models: [] } as unknown as Awaited<ReturnType<typeof fetchAiModelComparison>>);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); root = createRoot(host);
});
afterEach(() => { act(() => { root.unmount(); }); vi.unstubAllGlobals(); });

it('keeps a conversation profile when the default changes', async () => {
  vi.mocked(fetchConfiguration).mockResolvedValue({ ai: { agents: profiles, active_agent_id: 'principal' } });
  await act(async () => { root.render(<Harness />); await Promise.resolve(); });
  expect(current().selectedAgentId).toBe('other');
  expect(current().agentList.map(profile => profile.id)).toEqual(['other', 'principal']);
  expect(current().agentConfig?.id).toBe('other');
  vi.mocked(fetchConfiguration).mockResolvedValue({ ai: { agents: profiles, active_agent_id: 'other' } });
  await act(async () => { host.querySelector('button')?.click(); await Promise.resolve(); });
  expect(current().selectedAgentId).toBe('other');
});
it('initializes a new conversation with the default', async () => {
  vi.mocked(fetchConfiguration).mockResolvedValue({ ai: { agents: profiles, active_agent_id: 'principal' } });
  await act(async () => { root.render(<Harness initial="" />); await Promise.resolve(); });
  expect(current().selectedAgentId).toBe('principal');
});
it('does not silently replace a removed conversation profile', async () => {
  vi.mocked(fetchConfiguration).mockResolvedValue({ ai: { agents: [profiles[1]], active_agent_id: 'principal' } });
  await act(async () => { root.render(<Harness />); await Promise.resolve(); });
  expect(current().agentConfig).toBeNull();
  expect(current().selectedAgentId).toBe('other');
  expect(current().agentList.map(profile => profile.id)).toEqual(['principal']);
});
it('excludes disabled and retired managed profiles', async () => {
  vi.mocked(fetchConfiguration).mockResolvedValue({ ai: { agents: [profiles[0], { id: 'disabled', enabled: false }, { id: 'wiki', managed_by: 'llm-wiki' }] } });
  await act(async () => { root.render(<Harness />); await Promise.resolve(); });
  expect(current().agentList.map(profile => profile.id)).toEqual(['other']);
});

it('loads the profile before model labels and then enriches the matching route', async () => {
  let resolveComparison!: (value: Awaited<ReturnType<typeof fetchAiModelComparison>>) => void;
  vi.mocked(fetchAiModelComparison).mockReturnValueOnce(new Promise(resolve => { resolveComparison = resolve; }));
  vi.mocked(fetchConfiguration).mockResolvedValue({ ai: { agents: [{ id: 'principal', name: 'My assistant', provider: 'openrouter', model: 'google/gemini' }], active_agent_id: 'principal' } });
  await act(async () => { root.render(<Harness initial="" />); });
  expect(current().agentConfig?.id).toBe('principal');
  expect(current().agentList[0]?.modelProfile).toBeUndefined();
  await act(async () => { resolveComparison({ models: [{ profile: 'allround', routes: [{ provider: 'openrouter', model_id: 'google/gemini' }] }] } as Awaited<ReturnType<typeof fetchAiModelComparison>>); });
  expect(current().agentList[0]?.modelProfile).toBe('allround');
});
