import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchGraphConfiguration, updateConfiguration } from '../../../shared/api/configuration';
import { fetchVaultGraph, graphQueryKey, type VaultGraphData } from '../../../shared/api/graph';
import { fetchVaultGlobalIndex, fetchVaultTables } from '../../../shared/api/vaults';
import { GraphViewer } from '../../../shared/graph/viewer/GraphViewer';
import { fixtureEdge, fixtureNode } from '../../../shared/graph/viewer/graphViewerFixtures';
import * as physics from '../../../shared/graph/viewer/graphViewerPhysics';
import { latestRenderer, TestRenderer } from '../../../shared/graph/viewer/graphViewerTestRenderer';
import { useGraphPageController } from './useGraphPageController';

vi.mock('sigma', async () => {
  const { TestRenderer: Renderer } = await import('../../../shared/graph/viewer/graphViewerTestRenderer');
  return { default: Renderer };
});
vi.mock('react-router-dom', () => ({ useLocation: () => ({ search: '' }) }));
vi.mock('../../../shared/notifications/notifyError', () => ({ logError: vi.fn() }));
vi.mock('../../../shared/api/configuration', () => ({ fetchGraphConfiguration: vi.fn(), updateConfiguration: vi.fn() }));
vi.mock('../../../shared/api/graph', async importOriginal => ({
  ...await importOriginal<typeof import('../../../shared/api/graph')>(), fetchVaultGraph: vi.fn(),
}));
vi.mock('../../../shared/api/vaults', () => ({ fetchVaultGlobalIndex: vi.fn(), fetchVaultTables: vi.fn() }));

const early = Date.parse('2026-01-01T00:00:00Z');
const late = Date.parse('2026-09-01T00:00:00Z');
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

function deferredGraph() {
  let resolve!: (data: VaultGraphData) => void;
  const promise = new Promise<VaultGraphData>(complete => { resolve = complete; });
  return { promise, resolve };
}

function datedGraph(): VaultGraphData {
  return {
    nodes: [
      fixtureNode('early', { created_time: early, metadata: { State: 'keep' } }),
      fixtureNode('late', { created_time: late, metadata: { State: 'keep' } }),
      fixtureNode('excluded', { created_time: late, metadata: { State: 'omit' } }),
      fixtureNode('invalid-date', { created_time: 'invalid', metadata: { State: 'keep' } }),
      fixtureNode('undated', { metadata: { State: 'keep' } }),
    ],
    edges: [fixtureEdge('early', 'late')],
    legend: { clusters: [], kinds: [] },
  };
}

function PageProbe() {
  const { controller } = useGraphPageController();
  if (controller.loading) return <output>Loading</output>;
  return <>
    <output data-testid="date">{controller.timelineDate}</output>
    <button type="button" onClick={() => { controller.setTimelineDate(early); }}>Earlier</button>
    <GraphViewer
      graphData={controller.graphData}
      filters={controller.filters}
      isPhysicsEnabled
      setGraphInstance={controller.setGraphInstance}
      setRendererInstance={controller.setRendererInstance}
      gravity={controller.gravity}
      repulsion={controller.repulsion}
      friction={controller.friction}
      edgeInfluence={controller.edgeInfluence}
      linLogMode={controller.linLogMode}
      strongGravityMode={controller.strongGravityMode}
      outboundAttractionDistribution={controller.outboundAttractionDistribution}
    />
  </>;
}

async function settle() {
  for (let turn = 0; turn < 3; turn++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  }
}

async function showPage() {
  const data = deferredGraph();
  vi.mocked(fetchVaultGraph).mockReturnValue(data.promise);
  await act(async () => {
    root.render(<QueryClientProvider client={client}><PageProbe /></QueryClientProvider>);
    await Promise.resolve();
  });
  // Configuration completes before the graph, as in the measured navigation.
  await settle();
  await act(async () => {
    data.resolve(datedGraph());
    await Promise.resolve();
  });
  await settle();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  TestRenderer.instances = [];
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(fetchGraphConfiguration).mockResolvedValue({ graph: {
    sources_initialized: true, visible_databases: ['wiki'], visible_fields: ['wiki:State'],
    field_defaults: { 'wiki:State': 'keep' }, visible_tables: [],
  } });
  vi.mocked(fetchVaultGlobalIndex).mockResolvedValue({});
  vi.mocked(fetchVaultTables).mockResolvedValue([]);
});

afterEach(() => {
  act(() => { root.unmount(); });
  client.clear();
  container.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, 'sigmaRenderer');
});

describe('initial graph timeline', () => {
  it('starts D3 once with the final initial cutoff and saved field filters already applied', async () => {
    const start = vi.spyOn(physics, 'createPhysics');
    await showPage();
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[1].filters?.timelineDate).toBe(late);
    expect(container.querySelector('[data-testid="date"]')?.textContent).toBe(String(late));
    expect(latestRenderer().initialNodes.filter(node => !node.hidden).map(node => node.key))
      .toEqual(['early', 'late', 'undated']);
    expect(latestRenderer().nodeAdded).not.toHaveBeenCalled();
    expect(updateConfiguration).not.toHaveBeenCalled();
  });

  it('keeps the selected cutoff on new graph data and restarts only for actual filter/data changes', async () => {
    const start = vi.spyOn(physics, 'createPhysics');
    await showPage();
    const first = latestRenderer();
    act(() => { container.querySelector('button')?.click(); });
    await settle();
    expect(start).toHaveBeenCalledTimes(2);
    expect(latestRenderer()).toBe(first);
    expect(first.graph.getNodeAttribute('late', 'hidden')).toBe(true);
    const next = datedGraph();
    next.nodes.push(fixtureNode('future', { created_time: late + 86_400_000, metadata: { State: 'keep' } }));
    await act(async () => {
      client.setQueryData(graphQueryKey(), next);
      await Promise.resolve();
    });
    await settle();
    expect(start).toHaveBeenCalledTimes(3);
    expect(TestRenderer.instances).toHaveLength(2);
    expect(container.querySelector('[data-testid="date"]')?.textContent).toBe(String(early));
    expect(latestRenderer().initialNodes.filter(node => !node.hidden).map(node => node.key))
      .toEqual(['early', 'undated']);
    expect(first.kill).toHaveBeenCalledTimes(1);
    expect(updateConfiguration).not.toHaveBeenCalled();
  });
});
