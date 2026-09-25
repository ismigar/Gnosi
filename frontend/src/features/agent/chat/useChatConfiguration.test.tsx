import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchConfiguration } from '../../../shared/api/configuration';
import { useChatConfiguration } from './useChatConfiguration';

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
    agentConfig: { id: string } | null; agentList: { id: string }[]; selectedAgentId: string;
  };
}
beforeEach(() => {
  vi.clearAllMocks();
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
