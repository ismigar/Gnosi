import React, { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchConfiguration, updateConfiguration } from '../../shared/api/configuration';
import { fetchVaultGraph } from '../../shared/api/graph';
import { fetchVaultGlobalIndex, fetchVaultTables } from '../../shared/api/vaults';
import { dispatchWindowEvent } from '../../shared/platform/browser-events';
import GraphPage from './GraphPage';


const graphViewerMocks = vi.hoisted(() => ({
  center: vi.fn(),
  fullscreen: vi.fn(),
  panToGraphPoint: vi.fn(),
  panToNode: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
}));


vi.mock('react-i18next', () => ({
  Trans: ({ children }: { children?: ReactNode }) => children,
  useTranslation: () => ({
    t: (key: string, fallback?: string | Readonly<Record<string, unknown>>) => {
      if (typeof fallback === 'string') return fallback;
      if (fallback && typeof fallback.defaultValue === 'string') {
        const count = typeof fallback.count === 'number' ? fallback.count : 0;
        return fallback.defaultValue.replace('{{count}}', String(count));
      }
      return key;
    },
  }),
}));


vi.mock('react-router-dom', () => ({
  useLocation: () => ({ search: '' }),
}));


vi.mock('../../shared/api/configuration', () => ({
  fetchConfiguration: vi.fn(),
  updateConfiguration: vi.fn(),
}));


vi.mock('../../shared/api/graph', () => ({ fetchVaultGraph: vi.fn() }));
vi.mock('../../shared/api/vaults', () => ({
  fetchVaultGlobalIndex: vi.fn(),
  fetchVaultTables: vi.fn(),
}));


vi.mock('../../components/Layout', () => ({
  Layout: ({
    bottomPanel,
    children,
    controls,
    sidebar,
  }: {
    bottomPanel?: ReactNode;
    children?: ReactNode;
    controls?: ReactNode;
    sidebar?: ReactNode;
  }) => (
    <main>
      <aside>{sidebar}</aside>
      <section>{controls}{children}</section>
      <footer>{bottomPanel}</footer>
    </main>
  ),
}));


vi.mock('../../components/Sidebar', () => ({
  Sidebar: ({
    afterWidgets,
    children,
    colorMode,
    onSearchSubmit,
  }: {
    afterWidgets?: ReactNode;
    children?: ReactNode;
    colorMode: string;
    onSearchSubmit?: (term: string) => void;
  }) => (
    <div data-testid="sidebar" data-color-mode={colorMode}>
      <button
        type="button"
        onClick={() => { onSearchSubmit?.('Target'); }}
      >
        Search target
      </button>
      {children}
      {afterWidgets}
    </div>
  ),
}));


vi.mock('../../shared/graph/viewer/GraphViewer', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  interface MockGraphViewerProps {
    readonly filters: { readonly selectedNode?: string | null };
  }
  return {
    GraphViewer: forwardRef(function MockGraphViewer(
      { filters }: MockGraphViewerProps,
      ref: React.ForwardedRef<typeof graphViewerMocks>,
    ) {
      useImperativeHandle(ref, () => graphViewerMocks);
      return (
        <div data-testid="graph-viewer" data-selected-node={filters.selectedNode ?? ''} />
      );
    }),
  };
});


vi.mock('../../shared/graph/minimap/Minimap', () => ({ Minimap: () => <div>Minimap</div> }));
vi.mock('./panels/NodeDetailsPanel', () => ({
  NodeDetailsPanel: () => <div>Node details</div>,
}));
vi.mock('../../components/VisualizationSection', () => ({
  VisualizationSection: () => <div>Visualization</div>,
}));
vi.mock('../../components/ForcesSection', () => ({
  ForcesSection: () => <div>Forces</div>,
}));
vi.mock('./panels/ConnectionList', () => ({
  ConnectionList: () => <div>Connections</div>,
}));
vi.mock('./panels/Controls', () => ({
  Controls: ({ legend }: { legend?: ReactNode }) => <div>{legend}</div>,
}));
vi.mock('./panels/Legend', () => ({
  Legend: ({
    filteredEdgesCount,
    filteredNodesCount,
  }: {
    filteredEdgesCount?: number;
    filteredNodesCount?: number;
  }) => <div>Counts {filteredNodesCount}/{filteredEdgesCount}</div>,
}));
vi.mock('../../components/GraphLoadingState', () => ({
  GraphLoadingState: ({ progress }: { progress: number }) => (
    <div>Loading {progress}</div>
  ),
}));


const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


const mockedFetchConfiguration = vi.mocked(fetchConfiguration);
const mockedFetchGraph = vi.mocked(fetchVaultGraph);
const mockedFetchGlobalIndex = vi.mocked(fetchVaultGlobalIndex);
const mockedFetchTables = vi.mocked(fetchVaultTables);
const mockedUpdateConfiguration = vi.mocked(updateConfiguration);


let container: HTMLDivElement;
let root: Root;


beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mockedFetchConfiguration.mockResolvedValue({
    graph: {
      graph_table_filters: [],
      sources_initialized: true,
      visible_databases: ['wiki'],
      visible_fields: ['wiki:Status'],
      visible_tables: [],
    },
  });
  mockedFetchGraph.mockResolvedValue({
    edges: [],
    legend: { clusters: [], kinds: [] },
    nodes: [{
      cluster: 'cluster-a',
      color: '#334155',
      created_time: '2026-08-30T00:00:00Z',
      database_id: null,
      id: 'target-id',
      key: 'target-id',
      kind: 'Wiki',
      label: 'Target',
      metadata: { Status: 'Done' },
      path: 'Target.md',
      size: 8,
      table_id: null,
    }],
  });
  mockedFetchGlobalIndex.mockResolvedValue({});
  mockedFetchTables.mockResolvedValue([]);
  mockedUpdateConfiguration.mockResolvedValue({ message: '', status: 'success' });
});


afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});


async function renderLoadedPage(): Promise<void> {
  await act(async () => {
    root.render(<GraphPage />);
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(901);
  });
}


function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (item) => item.textContent.trim() === label,
  );
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return found;
}


describe('GraphPage', () => {
  it('does not seed graph sources before graph configuration exists', async () => {
    mockedFetchConfiguration.mockResolvedValue({});
    await renderLoadedPage();

    expect(mockedUpdateConfiguration).not.toHaveBeenCalled();
  });

  it('seeds classified sources once when graph configuration is uninitialized', async () => {
    mockedFetchConfiguration.mockResolvedValue({ graph: {} });
    await renderLoadedPage();

    expect(mockedUpdateConfiguration).toHaveBeenCalledTimes(1);
    expect(mockedUpdateConfiguration).toHaveBeenCalledWith({
      graph: {
        sources_initialized: true,
        visible_databases: ['wiki'],
        visible_tables: ['wiki'],
      },
    });
  });

  it('loads graph data and renders safe system-field filters', async () => {
    await renderLoadedPage();

    expect(container.textContent).toContain('Wiki: Status');
    expect(container.textContent).toContain('Done (1)');
    expect(container.textContent).toContain('Counts 1/0');
    expect(mockedUpdateConfiguration).not.toHaveBeenCalled();
  });

  it('navigates searches through GraphViewer and cycles cluster color mode', async () => {
    await renderLoadedPage();

    act(() => { button('Search target').click(); });
    expect(graphViewerMocks.panToNode).toHaveBeenCalledWith('target-id', 2.5);
    expect(container.querySelector('[data-testid="graph-viewer"]')
      ?.getAttribute('data-selected-node')).toBe('target-id');

    act(() => {
      dispatchWindowEvent(new KeyboardEvent('keydown', {
        key: 'c',
        metaKey: true,
        shiftKey: true,
      }));
    });
    expect(container.querySelector('[data-testid="sidebar"]')
      ?.getAttribute('data-color-mode')).toBe('cluster');
  });
});
