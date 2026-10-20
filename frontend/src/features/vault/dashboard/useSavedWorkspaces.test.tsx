import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiTestStorage, writeApiTestStorage } from '../../../../tests/api-request';
import { useSavedWorkspaces } from './useSavedWorkspaces';
import type { DashboardController } from './useDashboardController';
import type { Tab } from './types';
import { defaultWorkspaceLayout, saveWorkspaceTab, type SavedWorkspace } from '../navigation/workspacesModel';

const mocks = vi.hoisted(() => ({ fetchPage: vi.fn(), fetchDrawing: vi.fn(), error: vi.fn(), vault: 'vault' }));
vi.mock('../../../shared/api/vaults', () => ({ fetchVaultPage: mocks.fetchPage }));
vi.mock('../../../shared/api/drawings', () => ({ fetchDrawing: mocks.fetchDrawing }));
vi.mock('../../../shared/api/vault-context', () => ({ getActiveVaultId: () => mocks.vault }));
vi.mock('../../../shared/notifications/toast', () => ({ toast: { error: mocks.error } }));
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let root: Root;
let container: HTMLDivElement;
let restore: (workspace: SavedWorkspace) => Promise<void>;
let context: DashboardController;
let openTabs: Tab[];
let rerender: () => void;
beforeEach(() => {
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.vault = 'vault';
    mocks.fetchPage.mockResolvedValue({ id: 'page', title: 'Fresh', content: 'server content' });
    mocks.fetchDrawing.mockResolvedValue({});
    openTabs = [{ id: 'existing', title: 'Open note', content: 'Unsaved local draft' }];
    context = {
        tabs: openTabs, registry: { tables: [{ id: 'table', name: 'Table' }], views: [], databases: [] },
        setTabs: vi.fn((update: (previous: Tab[]) => Tab[]) => { openTabs = update(openTabs); }),
        setActiveTabId: vi.fn(), setActiveTableId: vi.fn(), setActiveViewId: vi.fn(), setViewMode: vi.fn(),
        setSplitTabIds: vi.fn(), setSplitTableIds: vi.fn(), setPaneSizes: vi.fn(), setSchema: vi.fn(), setViews: vi.fn(),
        getSchemaFromTableId: vi.fn(() => ({})), fetchPagesByTable: vi.fn(), t: (_key: string, fallback: string) => fallback,
    } as unknown as DashboardController;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    function Harness() { restore = useSavedWorkspaces(context).restoreWorkspace; return null; }
    rerender = () => { root.render(<Harness />); };
    act(rerender);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); resetApiTestStorage(); delete testGlobal.IS_REACT_ACT_ENVIRONMENT; });
function workspace(): SavedWorkspace {
    const tabs = [saveWorkspaceTab({ id: 'page', title: 'Page' }, ''), saveWorkspaceTab({ id: 'drawing', title: 'Canvas', isDrawing: true }, ''), saveWorkspaceTab({ id: 'pdf', title: 'Paper', isPdf: true, kind: 'epub', src: '/source/book.epub', location: { pageNumber: 4 } }, '')];
    return { version: 2, id: 'work', name: 'Study', vaultId: 'vault', tabs, layout: { ...defaultWorkspaceLayout(tabs), activeTabId: 'pdf', splitTabIds: ['page'], splitTableIds: ['table'], paneSizes: [50, 20, 30] } };
}
describe('workspace restoration', () => {
    it('restores all document kinds and split geometry while preserving open editor drafts', async () => {
        await act(async () => { await restore(workspace()); });
        expect(openTabs.map(tab => tab.id)).toEqual(['page', 'drawing', 'pdf', 'existing']);
        expect(openTabs.at(-1)?.content).toBe('Unsaved local draft');
        expect(openTabs[2]).toMatchObject({ isPdf: true, kind: 'epub', src: '/source/book.epub', location: { pageNumber: 4 } });
        expect(context.setActiveTabId).toHaveBeenCalledWith('pdf');
        expect(context.setPaneSizes).toHaveBeenCalledWith([50, 20, 30]);
        expect(context.setSplitTabIds).toHaveBeenCalledWith(['page']);
        expect(context.setSplitTableIds).toHaveBeenCalledWith(['table']);
    });
    it('does not mutate any tabs or layout when a saved document is missing', async () => {
        mocks.fetchDrawing.mockRejectedValueOnce(new Error('404'));
        await act(async () => { await restore(workspace()); });
        expect(context.setTabs).not.toHaveBeenCalled();
        expect(context.setPaneSizes).not.toHaveBeenCalled();
        expect(mocks.error).toHaveBeenCalledOnce();
    });
    it('does not replace an already-open page with remote or saved content', async () => {
        context.tabs.push({ id: 'page', title: 'Local title', content: 'Local draft' });
        await act(async () => { await restore(workspace()); });
        expect(mocks.fetchPage).not.toHaveBeenCalled();
        expect(openTabs[0]).toMatchObject({ title: 'Local title', content: 'Local draft' });
    });
    it('does not apply an asynchronous result after switching Vault', async () => {
        let finish: (value: unknown) => void = () => undefined;
        mocks.fetchPage.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const pending = restore(workspace());
        mocks.vault = 'other';
        await act(async () => { finish({ id: 'page', title: 'Wrong Vault' }); await pending; });
        expect(context.setTabs).not.toHaveBeenCalled();
    });
    it('restores saved reader state for an already-open EPUB without replacing unrelated tab state', async () => {
        const current = { id: 'pdf', title: 'Reading now', isPdf: true, kind: 'epub' as const, src: '/source/current.epub',
            location: { pageNumber: 18 }, origin: { tabId: 'existing', tableId: 'old-table', viewId: 'old-view' }, readerPlugin: 'preserve' };
        openTabs.push(current);
        const saved = workspace();
        await act(async () => { await restore(saved); });
        expect(openTabs.find(tab => tab.id === 'pdf')).toMatchObject({ title: 'Paper', src: '/source/book.epub', kind: 'epub', location: { pageNumber: 4 }, readerPlugin: 'preserve' });
        expect(openTabs.find(tab => tab.id === 'pdf')?.origin).toBeUndefined();
        expect(openTabs.find(tab => tab.id === 'existing')?.content).toBe('Unsaved local draft');
    });
    it('cancels a pending restore after the user navigates elsewhere', async () => {
        let finish: (value: unknown) => void = () => undefined;
        mocks.fetchPage.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const pending = restore(workspace());
        context = { ...context, activeTabId: 'other-page', viewMode: 'editor' };
        act(rerender);
        await act(async () => { finish({ id: 'page', title: 'Fetched page' }); await pending; });
        expect(context.setTabs).not.toHaveBeenCalled();
        expect(mocks.error).not.toHaveBeenCalled();
    });
    it('applies only the latest workspace when restores overlap', async () => {
        let finish: (value: unknown) => void = () => undefined;
        mocks.fetchPage.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const pending = restore(workspace());
        const tabs = [saveWorkspaceTab({ id: 'latest-reader', title: 'Latest', isPdf: true, src: '/latest.pdf', location: { pageNumber: 8 } }, '')];
        await act(async () => { await restore({ ...workspace(), tabs, layout: defaultWorkspaceLayout(tabs) }); });
        await act(async () => { finish({ id: 'page', title: 'Older workspace' }); await pending; });
        expect(context.setTabs).toHaveBeenCalledOnce();
        expect(context.setActiveTabId).toHaveBeenCalledWith('latest-reader');
        expect(openTabs.some(tab => tab.id === 'page')).toBe(false);
    });
    it.each(['gnosi_workspace_id', 'gnosi_user_id', 'gnosi_user_email'])('rejects late results after %s changes in the same Vault', async field => {
        let finish: (value: unknown) => void = () => undefined;
        mocks.fetchPage.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const pending = restore(workspace());
        writeApiTestStorage(field, 'new-scope');
        await act(async () => { finish({ id: 'page', title: 'Fetched page' }); await pending; });
        expect(context.setTabs).not.toHaveBeenCalled();
        expect(mocks.error).not.toHaveBeenCalled();
    });

});
