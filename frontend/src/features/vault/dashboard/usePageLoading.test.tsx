import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { expect, it, vi } from 'vitest';
import { usePageLoading } from './usePageLoading';

const pageId = '11111111-1111-4111-8111-111111111111';
vi.mock('../../../shared/api/vaults', () => ({
    fetchVaultPage: vi.fn(() => Promise.resolve({ id: '11111111-1111-4111-8111-111111111111', title: 'Favorite', content: 'Saved text', metadata: {} })),
    resolveVaultTitle: vi.fn(),
}));
vi.mock('../../../shared/notifications/notifyError', () => ({ notifyError: vi.fn() }));
vi.mock('../../../shared/routing/vaultRouting', () => ({
    knowledgeDocumentType: () => 'page', vaultPath: () => '/synthetic/knowledge',
}));

it.each([null, 'table-id'])('opens a favorite while catalogs remain pending (table %s)', async tableId => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const pendingCatalog = new Promise<never>(() => {});
    const context: Parameters<typeof usePageLoading>[0] = {
        activeLoadAbortRef: { current: null }, consumedRecordReturnFocusRef: { current: null },
        setConsumedRecordReturnFocus: vi.fn(), globalIndex: {}, navigate: vi.fn(), nestedPath: undefined,
        pageRequestAbortersRef: { current: new Map() }, pageRequestInFlightRef: { current: new Map() },
        pages: [], pagesRef: { current: [] }, recordReturnFocusSequenceRef: { current: 0 },
        setActiveTabId: vi.fn(), setActiveTableId: vi.fn(), setRecordReturnFocus: vi.fn(),
        setTabs: vi.fn(), setViewMode: vi.fn(), t: createInstance().t, tabs: [],
        fetchFullPages: vi.fn(() => pendingCatalog), fetchPagesByTable: vi.fn(() => pendingCatalog),
        pushToHistory: vi.fn(), resolvePageTableId: () => tableId,
    };
    let loader: ReturnType<typeof usePageLoading> | undefined;
    function Harness() { loader = usePageLoading(context); return null; }
    const root = createRoot(document.createElement('div'));
    try {
        act(() => { root.render(<Harness />); });
        await act(async () => { await loader?.loadPage(pageId); });
        expect(context.setActiveTabId).toHaveBeenCalledWith(pageId);
        expect(context.setTabs).toHaveBeenCalledTimes(1);
        expect(context.setViewMode).toHaveBeenCalledWith('editor');
        expect(context.pushToHistory).toHaveBeenCalledWith({ type: 'editor', id: pageId, resourceType: 'page' });
        expect(context.fetchFullPages).toHaveBeenCalledTimes(1);
        if (tableId) expect(context.fetchPagesByTable).toHaveBeenCalledWith(tableId);
    } finally {
        act(() => { root.unmount(); });
        vi.unstubAllGlobals();
    }
}, 2000);
