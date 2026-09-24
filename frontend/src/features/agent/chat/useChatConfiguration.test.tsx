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

function Harness() {
  const [selectedAgentId, setSelectedAgentId] = useState('other');
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

it('uses only the principal even when a saved profile was previously selected', async () => {
  vi.mocked(fetchConfiguration).mockResolvedValue({ ai: { agents: profiles, active_agent_id: 'principal' } });
  await act(async () => { root.render(<Harness />); await Promise.resolve(); });
  expect(current().selectedAgentId).toBe('principal');
  expect(current().agentList.map(profile => profile.id)).toEqual(['principal']);
  expect(current().agentConfig?.id).toBe('principal');
  expect(fetchConfiguration).toHaveBeenCalledOnce();
});

it('follows a changed principal and clears its stale model when that principal becomes unavailable', async () => {
  vi.mocked(fetchConfiguration).mockResolvedValue({ ai: { agents: profiles, active_agent_id: 'principal' } });
  await act(async () => { root.render(<Harness />); await Promise.resolve(); });
  vi.mocked(fetchConfiguration).mockResolvedValue({ ai: { agents: profiles, active_agent_id: 'other' } });
  await act(async () => { host.querySelector('button')?.click(); await Promise.resolve(); });
  expect(current().selectedAgentId).toBe('other');
  expect(current().agentConfig?.id).toBe('other');
  vi.mocked(fetchConfiguration).mockResolvedValue({ ai: { agents: profiles, active_agent_id: 'missing' } });
  await act(async () => { host.querySelector('button')?.click(); await Promise.resolve(); });
  expect(current()).toEqual({ agentConfig: null, agentList: [], selectedAgentId: '' });
});

it('does not silently replace a disabled explicit principal with a saved profile', async () => {
  vi.mocked(fetchConfiguration).mockResolvedValue({ ai: {
    agents: [{ ...profiles[1], enabled: false }, profiles[0]], active_agent_id: 'principal',
  } });
  await act(async () => { root.render(<Harness />); await Promise.resolve(); });
  expect(current()).toEqual({ agentConfig: null, agentList: [], selectedAgentId: '' });
});
