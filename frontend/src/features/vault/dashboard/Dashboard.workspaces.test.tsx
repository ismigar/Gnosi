import { act, useState, type PropsWithChildren } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { SavedWorkspace } from '../navigation/workspacesModel';
import type { DashboardController } from './useDashboardController';
import type { Tab, ViewMode } from './types';
import Dashboard from './Dashboard';

const mocks = vi.hoisted(() => ({ fetchPage: vi.fn() }));
vi.mock('../../../shared/api/vaults', () => ({ fetchVaultPage: mocks.fetchPage }));
vi.mock('../../../shared/api/drawings', () => ({ fetchDrawing: vi.fn() }));
vi.mock('../../../shared/api/vault-context', () => ({ getActiveVaultId: () => 'vault' }));
vi.mock('../navigation/VaultShell', () => ({ VaultShell: ({ children }: PropsWithChildren) => <>{children}</> }));
vi.mock('./DashboardSidebar', () => ({ DashboardSidebar: () => null }));
vi.mock('./CreationRecoveryPanel', () => ({ CreationRecoveryPanel: () => null }));
vi.mock('./DashboardContent', () => ({ DashboardContent: ({ activeTabId, viewMode }: DashboardController) => <output>{activeTabId}:{viewMode}</output> }));
vi.mock('./useDashboardController', () => ({ useDashboardController: () => useFixtureController() }));
vi.mock('./BrowseDialogs', () => ({ BrowseDialogs: ({ onRestoreWorkspace, setIsWorkspacesOpen }: {
  onRestoreWorkspace: (workspace: SavedWorkspace) => Promise<void>;
  setIsWorkspacesOpen: (value: boolean) => void;
}) => <button onClick={() => { void onRestoreWorkspace(saved); setIsWorkspacesOpen(false); }}>Restore and close dialog</button> }));

const saved: SavedWorkspace = {
  version: 2, id: 'saved', name: 'Saved', vaultId: 'vault', tabs: [{ id: 'note', title: 'Note', type: 'page' }],
  layout: { activeTabId: 'note', activeTableId: null, activeViewId: null, viewMode: 'editor', splitTabIds: [], splitTableIds: [], paneSizes: [100] },
};
function useFixtureController(): DashboardController {
  const [tabs, setTabs] = useState<Tab[]>([{ id: 'drawing', title: 'Canvas', isDrawing: true }]);
  const [activeTabId, setActiveTabId] = useState<string | null>('drawing');
  const [viewMode, setViewMode] = useState<ViewMode>('drawing');
  const [isWorkspacesOpen, setIsWorkspacesOpen] = useState(true);
  const noop = () => undefined;
  return { tabs, setTabs, activeTabId, setActiveTabId, viewMode, setViewMode, isWorkspacesOpen, setIsWorkspacesOpen,
    promptModal: { isOpen: false }, registry: { tables: [], views: [] }, activeTableId: null, activeViewId: null,
    setActiveTableId: noop, setActiveViewId: noop, setSplitTabIds: noop, setSplitTableIds: noop, setPaneSizes: noop,
    t: (_key: string, fallback: string) => fallback,
  } as unknown as DashboardController;
}

it('finishes workspace restoration after its dialog unmounts from drawing mode', async () => {
  const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  let finish: (page: unknown) => void = () => undefined;
  mocks.fetchPage.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  try {
    await act(async () => { root.render(<Dashboard />); await Promise.resolve(); });
    const button = host.querySelector('button');
    expect(button).not.toBeNull();
    act(() => { button?.click(); });
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('output')?.textContent).toBe('drawing:drawing');
    await act(async () => { finish({ id: 'note', title: 'Note', content: 'Source', etag: 'revision' }); await Promise.resolve(); });
    expect(host.querySelector('output')?.textContent).toBe('note:editor');
  } finally {
    act(() => { root.unmount(); }); host.remove(); delete testGlobal.IS_REACT_ACT_ENVIRONMENT;
  }
});
