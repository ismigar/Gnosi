import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchGraphConfiguration } from '../../../shared/api/configuration';
import { fetchVaultGraph } from '../../../shared/api/graph';
import { useVaultGraphData } from '../../../shared/api/useGraphData';
import { fetchVaultGlobalIndex, fetchVaultTables } from '../../../shared/api/vaults';
import { graphServerQueryKeys, useGraphServerData } from './useGraphServerData';

const scope = vi.hoisted(() => ({ vaultId: 'alpha' }));
vi.mock('../../../shared/api/vault-context', async importOriginal => ({
  ...await importOriginal<typeof import('../../../shared/api/vault-context')>(),
  getActiveVaultId: () => scope.vaultId,
}));
vi.mock('../../../shared/api/configuration', () => ({ fetchGraphConfiguration: vi.fn(), updateConfiguration: vi.fn() }));
vi.mock('../../../shared/api/graph', async importOriginal => ({
  ...await importOriginal<typeof import('../../../shared/api/graph')>(),
  fetchVaultGraph: vi.fn(),
}));
vi.mock('../../../shared/api/vaults', () => ({ fetchVaultGlobalIndex: vi.fn(), fetchVaultTables: vi.fn() }));

const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
type ServerData = ReturnType<typeof useGraphServerData>;
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

function graph(label: string): Awaited<ReturnType<typeof fetchVaultGraph>> {
  return {
    nodes: [{ key: 'same-id', id: 'same-id', label, kind: 'Wiki', metadata: {}, path: 'fixture.md', size: 8,
      cluster: null, color: '#000', database_id: null, table_id: null }],
    edges: [],
    legend: { clusters: [], kinds: [] },
  };
}

function InlineGraph() {
  const query = useVaultGraphData();
  return <output data-testid="inline-graph">{query.data?.nodes[0]?.label ?? 'pending'}</output>;
}

function Probe({ capture, inline }: { capture?: (server: ServerData) => void; inline: boolean }) {
  const server = useGraphServerData();
  capture?.(server);
  return <>
    <output data-testid="configuration">{JSON.stringify(server.configuration.data ?? null)}</output>
    <output data-testid="graph">{server.graph.data?.nodes[0]?.label ?? 'pending'}</output>
    <output data-testid="tables">{JSON.stringify(server.tables.data ?? null)}</output>
    <output data-testid="index">{JSON.stringify(server.globalIndex.data ?? null)}</output>
    {inline && <InlineGraph />}
  </>;
}

async function settle() {
  // Query notifications and the dependent index query each get their own turn.
  for (let turn = 0; turn < 3; turn++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  }
}

async function renderProbe(capture?: (server: ServerData) => void, inline = false) {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><Probe capture={capture} inline={inline} /></QueryClientProvider>);
    await Promise.resolve();
  });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  scope.vaultId = 'alpha';
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(fetchGraphConfiguration).mockResolvedValue({ graph: { sources_initialized: true, visible_fields: [] } });
  vi.mocked(fetchVaultGraph).mockImplementation(() => Promise.resolve(graph(scope.vaultId)));
  vi.mocked(fetchVaultTables).mockImplementation(() => Promise.resolve([{ id: 'same-table', name: scope.vaultId }]));
  vi.mocked(fetchVaultGlobalIndex).mockImplementation(() => Promise.resolve({ 'same-id': scope.vaultId }));
});

afterEach(() => {
  act(() => { root.unmount(); });
  client.clear();
  container.remove();
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe('graph server query dependencies and vault scope', () => {
  it.each([{ fields: undefined }, { fields: [] }, { fields: ['invalid'] }])('does not read the global index without rendered field filters (%j)', async ({ fields }) => {
    vi.mocked(fetchGraphConfiguration).mockResolvedValue(fields === undefined
      ? { graph: {} }
      : { graph: { visible_fields: fields } });
    await renderProbe();
    expect(fetchVaultGlobalIndex).not.toHaveBeenCalled();
    expect(fetchVaultGraph).toHaveBeenCalledTimes(1);
    expect(fetchVaultTables).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="graph"]')?.textContent).toBe('alpha');
  });

  it('starts graph and tables while configuration is pending and reads labels once fields are configured', async () => {
    const configuration = deferred<Awaited<ReturnType<typeof fetchGraphConfiguration>>>();
    vi.mocked(fetchGraphConfiguration).mockReturnValue(configuration.promise);
    await renderProbe();
    expect(fetchVaultGraph).toHaveBeenCalledTimes(1);
    expect(fetchVaultTables).toHaveBeenCalledTimes(1);
    expect(fetchVaultGlobalIndex).not.toHaveBeenCalled();
    await act(async () => {
      configuration.resolve({ graph: { visible_fields: ['same-table:Relation'] } });
      await Promise.resolve();
    });
    await settle();
    expect(fetchVaultGlobalIndex).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="index"]')?.textContent).toContain('alpha');
  });

  it('shares the same graph with the embedded viewer and preserves prefix invalidation after navigation', async () => {
    await renderProbe(undefined, true);
    expect(fetchVaultGraph).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="inline-graph"]')?.textContent).toBe('alpha');
    act(() => { root.render(null); });
    await renderProbe(undefined, true);
    expect(fetchVaultGraph).toHaveBeenCalledTimes(1);
    act(() => { root.render(null); });
    await client.invalidateQueries({ queryKey: ['graph'], refetchType: 'none' });
    await renderProbe(undefined, true);
    expect(fetchVaultGraph).toHaveBeenCalledTimes(2);
  });

  it('does not reuse recent data from another vault with the same graph and table IDs', async () => {
    vi.mocked(fetchGraphConfiguration).mockImplementation(() => Promise.resolve({
      graph: { visible_fields: ['same-table:Relation'] }, fixture_vault: scope.vaultId,
    }));
    await renderProbe();
    expect(container.textContent).toContain('alpha');
    const betaGraph = deferred<Awaited<ReturnType<typeof fetchVaultGraph>>>();
    vi.mocked(fetchVaultGraph).mockReturnValue(betaGraph.promise);
    scope.vaultId = 'beta';
    await renderProbe();
    expect(container.textContent).not.toContain('alpha');
    expect(container.querySelector('[data-testid="graph"]')?.textContent).toBe('pending');
    expect(container.textContent).toContain('beta');
    await act(async () => { betaGraph.resolve(graph('beta')); await Promise.resolve(); });
    await settle();
    expect(container.querySelector('[data-testid="graph"]')?.textContent).toBe('beta');
    expect(fetchVaultGraph).toHaveBeenCalledTimes(2);
    expect(fetchVaultGlobalIndex).toHaveBeenCalledTimes(2);
    expect(fetchVaultTables).toHaveBeenCalledTimes(2);
    expect(fetchGraphConfiguration).toHaveBeenCalledTimes(2);
  });

  it('ignores late old-vault responses and keeps replacements bound to their original vault', async () => {
    const oldGraph = deferred<Awaited<ReturnType<typeof fetchVaultGraph>>>();
    const oldConfiguration = deferred<Awaited<ReturnType<typeof fetchGraphConfiguration>>>();
    vi.mocked(fetchVaultGraph).mockReturnValueOnce(oldGraph.promise);
    vi.mocked(fetchGraphConfiguration).mockReturnValueOnce(oldConfiguration.promise);
    const original: { current?: ServerData } = {};
    await renderProbe(server => { original.current = server; });
    const oldSignal = vi.mocked(fetchVaultGraph).mock.calls[0]?.[0];
    const replaceOriginal = original.current?.replaceConfiguration;
    scope.vaultId = 'beta';
    await renderProbe();
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => {
      oldGraph.resolve(graph('alpha'));
      oldConfiguration.resolve({ graph: { visible_fields: ['same-table:Old'] }, fixture_vault: 'alpha' });
      replaceOriginal?.({ fixture_vault: 'alpha replacement' });
      await Promise.resolve();
    });
    await settle();
    expect(container.textContent).not.toContain('alpha');
    expect(container.querySelector('[data-testid="graph"]')?.textContent).toBe('beta');
    expect(fetchVaultGlobalIndex).not.toHaveBeenCalled();
    expect(client.getQueryData(graphServerQueryKeys.configuration('alpha'))).toEqual({ fixture_vault: 'alpha replacement' });
    expect(client.getQueryData(graphServerQueryKeys.configuration('beta'))).toEqual({ graph: { sources_initialized: true, visible_fields: [] } });
  });
});
