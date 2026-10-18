import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchGraphConfiguration,
  updateConfiguration,
  type ConfigurationDocument,
  type ConfigurationUpdateInput,
} from '../../../shared/api/configuration';
import { fetchVaultGraph } from '../../../shared/api/graph';
import { fetchVaultGlobalIndex, fetchVaultTables } from '../../../shared/api/vaults';
import { notifyError } from '../../../shared/notifications/notifyError';
import { fixtureNode } from '../../../shared/graph/viewer/graphViewerFixtures';
import { graphServerQueryKeys } from './useGraphServerData';
import { useGraphPageController, type GraphPageController } from './useGraphPageController';

const context = vi.hoisted(() => ({ vaultId: 'synthetic-vault-a' }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ search: '' }) }));
vi.mock('../../../shared/i18n/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('../../../shared/api/vault-context', () => ({ getActiveVaultId: () => context.vaultId }));
vi.mock('../../../shared/notifications/notifyError', () => ({ logError: vi.fn(), notifyError: vi.fn() }));
vi.mock('../../../shared/api/configuration', () => ({ fetchGraphConfiguration: vi.fn(), updateConfiguration: vi.fn() }));
vi.mock('../../../shared/api/graph', async importOriginal => ({
  ...await importOriginal<typeof import('../../../shared/api/graph')>(), fetchVaultGraph: vi.fn(),
}));
vi.mock('../../../shared/api/vaults', () => ({ fetchVaultGlobalIndex: vi.fn(), fetchVaultTables: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let controller: GraphPageController;
let stored: ConfigurationDocument;

function initialConfiguration(): ConfigurationDocument {
  return {
    editor: { keep: 'editor configuration' },
    graph: {
      sources_initialized: true, visible_databases: ['wiki'], visible_tables: ['table-a'],
      visible_fields: ['Title'], show_arrows: true, node_size: 0.7,
      physics: {
        gravity: 0.3, repulsion: 400, friction: 8, edge_influence: 2,
        lin_log_mode: false, strong_gravity_mode: true, outbound_attraction_distribution: false,
      },
    },
  };
}

// Synthetic POST /config fixture implements the documented recursive merge.
function merge(input: ConfigurationUpdateInput) {
  const graph = input.graph as Record<string, unknown>;
  const current = stored.graph as Record<string, unknown>;
  stored = { ...stored, graph: {
    ...current, ...graph,
    physics: { ...current.physics as object, ...graph.physics as object },
  } };
  return { status: 'success', message: 'Configuration updated' };
}

function Probe() {
  const current = useGraphPageController().controller;
  useEffect(() => { controller = current; }, [current]);
  return <output>{JSON.stringify(values(current))}</output>;
}
function values(current = controller) {
  return [current.showArrows, current.linLogMode,
    current.strongGravityMode, current.outboundAttractionDistribution];
}
async function settle() {
  for (let turn = 0; turn < 4; turn++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  }
}
async function mount(reuseClient = false) {
  if (!reuseClient) client = new QueryClient({ defaultOptions: {
    queries: { retry: false, staleTime: 15_000 }, mutations: { retry: false },
  } });
  root = createRoot(container);
  act(() => {
    root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
  });
  await settle();
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function hydrateStaleConfiguration() {
  act(() => {
    client.setQueryData(graphServerQueryKeys.configuration(), initialConfiguration());
  });
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  context.vaultId = 'synthetic-vault-a';
  stored = initialConfiguration();
  container = document.createElement('div');
  document.body.append(container);
  vi.mocked(fetchGraphConfiguration).mockImplementation(() => Promise.resolve(structuredClone(stored)));
  vi.mocked(updateConfiguration).mockImplementation(input => Promise.resolve(merge(input)));
  vi.mocked(fetchVaultGraph).mockResolvedValue({ nodes: [], edges: [], legend: { clusters: [], kinds: [] } });
  vi.mocked(fetchVaultTables).mockResolvedValue([]);
  vi.mocked(fetchVaultGlobalIndex).mockResolvedValue({});
});
afterEach(() => {
  act(() => { root.unmount(); });
  client.clear();
  container.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('graph toggle persistence', () => {
  it('hydrates without writing and reopens all four saved choices without losing unrelated configuration', async () => {
    await mount();
    expect(values()).toEqual([true, false, true, false]);
    expect(updateConfiguration).not.toHaveBeenCalled();
    act(() => {
      controller.setShowArrows(false);
      controller.setLinLogMode(true);
      controller.setStrongGravityMode(false);
      controller.setOutboundAttractionDistribution(true);
    });
    await settle();
    expect(vi.mocked(updateConfiguration).mock.calls.map(([input]) => input)).toEqual([
      { graph: { show_arrows: false } },
      { graph: { physics: { lin_log_mode: true } } },
      { graph: { physics: { strong_gravity_mode: false } } },
      { graph: { physics: { outbound_attraction_distribution: true } } },
    ]);
    expect(stored).toEqual({
      ...initialConfiguration(),
      graph: { ...initialConfiguration().graph as object, show_arrows: false,
        physics: { gravity: 0.3, repulsion: 400, friction: 8, edge_influence: 2,
          lin_log_mode: true, strong_gravity_mode: false, outbound_attraction_distribution: true } },
    });
    act(() => { root.unmount(); });
    await mount(true);
    expect(values()).toEqual([false, true, false, true]);
    expect(fetchGraphConfiguration).toHaveBeenCalledTimes(1);
    expect(updateConfiguration).toHaveBeenCalledTimes(4);
    act(() => { root.unmount(); });
    client.clear();
    await mount();
    expect(values()).toEqual([false, true, false, true]);
    expect(fetchGraphConfiguration).toHaveBeenCalledTimes(2);
    expect(updateConfiguration).toHaveBeenCalledTimes(4);
  });

  it('serializes rapid selections and ignores stale hydration while saving and after acknowledgement', async () => {
    await mount();
    const first = deferred();
    vi.mocked(updateConfiguration).mockImplementationOnce(async input => {
      await first.promise;
      return merge(input);
    });
    act(() => { controller.setShowArrows(false); });
    await settle();
    act(() => {
      controller.setShowArrows(true);
      controller.setShowArrows(false);
      controller.setLinLogMode(true);
    });
    await hydrateStaleConfiguration();
    expect(values()).toEqual([false, true, true, false]);
    expect(updateConfiguration).toHaveBeenCalledTimes(1);
    act(() => { first.resolve(); });
    await settle();
    expect(updateConfiguration).toHaveBeenCalledTimes(4);
    await hydrateStaleConfiguration();
    expect(values()).toEqual([false, true, true, false]);
    expect((stored.graph as Record<string, unknown>).show_arrows).toBe(false);
    act(() => { root.unmount(); });
    await mount(true);
    expect(values()).toEqual([false, true, true, false]);
    expect(fetchGraphConfiguration).toHaveBeenCalledTimes(1);
    expect(updateConfiguration).toHaveBeenCalledTimes(4);
  });

  it('reports failure, rolls back the latest failed choice, and permits an explicit next attempt', async () => {
    await mount();
    const failure = new Error('Synthetic disk failure');
    vi.mocked(updateConfiguration).mockRejectedValueOnce(failure);
    act(() => { controller.setStrongGravityMode(false); });
    await settle();
    expect(values()).toEqual([true, false, true, false]);
    expect(notifyError).toHaveBeenCalledWith('graph-config-save', failure, 'settings.save_error');
    expect(updateConfiguration).toHaveBeenCalledTimes(1);
    act(() => { controller.setStrongGravityMode(false); });
    await settle();
    expect(values()).toEqual([true, false, false, false]);
    expect(updateConfiguration).toHaveBeenCalledTimes(2);
  });

  it('does not roll back a newer selection when an earlier write fails', async () => {
    await mount();
    const first = deferred();
    vi.mocked(updateConfiguration).mockImplementationOnce(async input => {
      await first.promise;
      return merge(input);
    });
    act(() => { controller.setLinLogMode(true); });
    await settle();
    act(() => { controller.setLinLogMode(false); controller.setLinLogMode(true); });
    act(() => { first.reject(new Error('Synthetic earlier failure')); });
    await settle();
    expect(values()).toEqual([true, true, true, false]);
    expect(updateConfiguration).toHaveBeenCalledTimes(3);
    expect(notifyError).toHaveBeenCalledTimes(1);
  });

  it('preserves newer configuration when an outstanding source seed completes', async () => {
    const seed = deferred();
    stored = { graph: { show_arrows: true } };
    vi.mocked(fetchVaultGraph).mockResolvedValue({
      nodes: [fixtureNode('synthetic-page')], edges: [], legend: { clusters: [], kinds: [] },
    });
    vi.mocked(updateConfiguration).mockImplementationOnce(async input => {
      await seed.promise;
      return merge(input);
    });
    await mount();
    expect(updateConfiguration).toHaveBeenCalledTimes(1);
    const newer: ConfigurationDocument = {
      ...initialConfiguration(), graph: {
        ...initialConfiguration().graph as object, show_arrows: false, node_size: 0.9,
      },
    };
    act(() => {
      client.setQueryData(graphServerQueryKeys.configuration(), newer);
    });
    await settle();
    act(() => { seed.resolve(); });
    await settle();
    const cached = client.getQueryData<ConfigurationDocument>(graphServerQueryKeys.configuration());
    expect(cached?.graph).toMatchObject({ sources_initialized: true, show_arrows: false, node_size: 0.9 });
    expect(controller.showArrows).toBe(false);
    expect(updateConfiguration).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('preserves new-mount intent while an old write completes (failure=%s)', async fails => {
    await mount();
    const oldWrite = deferred();
    const newerWrite = deferred();
    vi.mocked(updateConfiguration)
      .mockImplementationOnce(async input => { await oldWrite.promise; return merge(input); })
      .mockImplementationOnce(async input => { await newerWrite.promise; return merge(input); });
    act(() => { controller.setShowArrows(false); });
    await settle();
    act(() => { root.unmount(); });
    await mount(true);
    expect(fetchGraphConfiguration).toHaveBeenCalledTimes(1);
    expect(controller.showArrows).toBe(false);
    act(() => { controller.setShowArrows(true); });
    await settle();
    expect(controller.showArrows).toBe(true);
    expect(updateConfiguration).toHaveBeenCalledTimes(1);
    act(() => {
      if (fails) oldWrite.reject(new Error('Synthetic old-mount failure'));
      else oldWrite.resolve();
    });
    await settle();
    expect(controller.showArrows).toBe(true);
    expect(updateConfiguration).toHaveBeenCalledTimes(2);
    expect(notifyError).toHaveBeenCalledTimes(fails ? 1 : 0);
    act(() => { newerWrite.resolve(); });
    await settle();
    expect(controller.showArrows).toBe(true);
    expect((stored.graph as Record<string, unknown>).show_arrows).toBe(true);
    expect(client.getQueryData<ConfigurationDocument>(graphServerQueryKeys.configuration())?.graph)
      .toMatchObject({ show_arrows: true, node_size: 0.7 });
    act(() => { root.unmount(); });
    await mount(true);
    expect(controller.showArrows).toBe(true);
    expect(updateConfiguration).toHaveBeenCalledTimes(2);
  });

  it('does not dispatch queued changes into a different Vault', async () => {
    await mount();
    const first = deferred();
    vi.mocked(updateConfiguration).mockImplementationOnce(async input => {
      await first.promise;
      return merge(input);
    });
    act(() => { controller.setShowArrows(false); });
    await settle();
    act(() => { controller.setLinLogMode(true); });
    context.vaultId = 'synthetic-vault-b';
    act(() => { first.resolve(); });
    await settle();
    expect(updateConfiguration).toHaveBeenCalledTimes(1);
    expect(notifyError).not.toHaveBeenCalled();
  });
});
