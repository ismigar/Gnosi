import React, { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { usePlanningState } from '../../shared/api/usePlanningData';
import { ACTIVE_VAULT_ID_KEY, ACTIVE_VAULT_SLUG_KEY } from '../../shared/api/vault-context';
import ProjectPlanningPage from './ProjectPlanningPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
vi.mock('../../shared/ui/layout/AppHeader', () => ({
  AppHeader: ({ children }: { children?: React.ReactNode }) => <header>{children}</header>,
}));
vi.mock('../../shared/record-views/VaultTimeline', () => ({ VaultTimeline: () => null }));
vi.mock('../../shared/plugins/usePlugins', () => ({
  usePlugins: () => ({
    getPluginSettings: () => ({ project_table_id: 'same-table' }),
    loaded: true,
    loadError: false,
  }),
}));

const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;

function StatePreview() {
  const query = usePlanningState();
  return <output>{query.data?.resources[0]?.name ?? ''}</output>;
}

function activateVault(vaultId: string) {
  writeApiTestStorage(ACTIVE_VAULT_ID_KEY, vaultId);
  writeApiTestStorage(ACTIVE_VAULT_SLUG_KEY, vaultId);
}

function payloadFor(path: string, label: string): unknown {
  if (path.endsWith('/references')) return [{ id: 'same-project', title: `${label} project` }];
  if (path.endsWith('/allocation')) return {
    revision: 1, assignment_summaries: [], buckets: [], warnings: [],
    total_estimated_cost: label === 'Alpha' ? 111 : 222,
  };
  if (path.endsWith('/state')) return {
    revision: 1, resources: [{ id: 'same-resource', name: `${label} resource` }],
  };
  if (path.endsWith('/worklogs')) return {
    worklogs: [{ id: 'same-worklog', taskId: `${label} task`, hours: 2 }],
    actualHoursByTask: { task: label === 'Alpha' ? 1 : 2 },
  };
  if (path.endsWith('/baselines')) return {
    baselines: [{ id: 'same-baseline', name: `${label} baseline`, scheduleRevision: 1 }],
  };
  if (path.endsWith('/schedule')) return {
    criticalTaskIds: [], diagnostics: [], projectId: 'same-project', scheduleRevision: 1,
    tasks: [{ id: 'same-task', title: `${label} task`, start: '2026-09-08', end: '2026-09-09' }],
  };
  throw new Error(`Unexpected synthetic request: ${path}`);
}

afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('isolates references and every planning read when vaults reuse table and project IDs', async () => {
  vi.useFakeTimers();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 15_000 } },
  });
  let releaseSecondVault!: () => void;
  const secondVaultReady = new Promise<void>((resolve) => { releaseSecondVault = resolve; });
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    if (!(input instanceof Request)) throw new Error('Expected a Request');
    const path = new URL(input.url).pathname;
    // Generated Request instances keep their legacy URL and use X-Vault-ID.
    // The real backend selects the vault from that middleware-provided header.
    const vaultId = input.headers.get('X-Vault-ID');
    if (vaultId !== 'vault-a' && vaultId !== 'vault-b') {
      throw new Error('Synthetic planning request is missing its vault context');
    }
    const secondVault = vaultId === 'vault-b';
    if (secondVault) await secondVaultReady;
    return Response.json(payloadFor(path, secondVault ? 'Beta' : 'Alpha'));
  });
  vi.stubGlobal('fetch', fetchMock);
  const render = () => {
    root.render(<QueryClientProvider client={client}>
      <StatePreview />
      <ProjectPlanningPage />
    </QueryClientProvider>);
  };
  try {
    activateVault('vault-a');
    await act(async () => {
      render();
      await vi.advanceTimersByTimeAsync(100);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(container.textContent).toContain('Alpha project');
    expect(container.textContent).toContain('Alpha task');
    expect(container.textContent).toContain('Alpha baseline');
    expect(container.textContent).toContain('Alpha resource');
    expect(container.textContent).toContain('111');
    expect(fetchMock).toHaveBeenCalledTimes(6);

    activateVault('vault-b');
    await act(async () => {
      render();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(container.textContent).not.toContain('Alpha');
    expect(container.textContent).not.toContain('111');
    expect(container.querySelector('select[aria-label="Project"]')).toHaveProperty('disabled', true);
    await act(async () => {
      releaseSecondVault();
      await vi.advanceTimersByTimeAsync(100);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(container.textContent).toContain('Beta project');
    expect(container.textContent).toContain('Beta task');
    expect(container.textContent).toContain('Beta baseline');
    expect(container.textContent).toContain('Beta resource');
    expect(container.textContent).toContain('222');
    expect(container.textContent).not.toContain('Alpha');
    expect(fetchMock).toHaveBeenCalledTimes(12);
    const requestVaults = fetchMock.mock.calls.map(([input]) => (
      input instanceof Request ? input.headers.get('X-Vault-ID') : null
    ));
    expect(requestVaults.filter((vaultId) => vaultId === 'vault-a')).toHaveLength(6);
    expect(requestVaults.filter((vaultId) => vaultId === 'vault-b')).toHaveLength(6);
  } finally {
    releaseSecondVault();
    act(() => { root.unmount(); });
    client.clear();
    container.remove();
  }
});
