import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vault from '../../../shared/api/vaults';
import * as views from '../../../shared/api/vault-views';
import { inFlightSaves } from '../editor/editorState';
import { CATALOG, DETAIL, PAGE, PAGE_ID, OTHER_ID, installApiDefaults, renderActions } from './test-support';
vi.mock('../../../shared/api/vaults');
vi.mock('../../../shared/api/vault-views');
let harness: Awaited<ReturnType<typeof renderActions>>;
beforeEach(async () => {
  vi.clearAllMocks();
  installApiDefaults();
  harness = await renderActions();
});
afterEach(async () => { await harness.unmount(); inFlightSaves.clear(); });
describe('page loading and tabs', () => {
  it('reuses a loaded page tab without replacing its local content', async () => {
    await harness.run(state => { state.setTabs([{ id: PAGE_ID, title: 'Local', content: 'unsaved' }]); });
    await harness.run(state => state.loadPage(PAGE_ID));
    expect(vault.fetchVaultPage).not.toHaveBeenCalled();
    expect(harness.current.activeTabId).toBe(PAGE_ID);
    expect(harness.current.tabs[0]?.content).toBe('unsaved');
  });
  it('deduplicates concurrent requests per page and clears both request registries', async () => {
    let resolve: ((value: typeof DETAIL) => void) | undefined;
    vi.mocked(vault.fetchVaultPage).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = harness.current.fetchPageById(PAGE_ID);
    const second = harness.current.fetchPageById(PAGE_ID);
    expect(vault.fetchVaultPage).toHaveBeenCalledTimes(1);
    resolve?.(DETAIL);
    await expect(first).resolves.toEqual({ data: DETAIL });
    await expect(second).resolves.toEqual({ data: DETAIL });
    expect(harness.current.pageRequestAbortersRef.current.size).toBe(0);
    expect(harness.current.pageRequestInFlightRef.current.size).toBe(0);
  });
  it('returns in-flight editor content, metadata and timestamp rather than the stale response', async () => {
    inFlightSaves.set(PAGE_ID, { content: 'pending', metadata: { title: 'Pending' }, timestamp: 0, promise: Promise.resolve() });
    const result = await harness.current.fetchPageById(PAGE_ID);
    expect(result?.data).toEqual({ id: PAGE_ID, title: 'Pending', content: 'pending', metadata: { title: 'Pending' }, last_modified: '1970-01-01T00:00:00.000Z' });
    expect(vault.fetchVaultPage).toHaveBeenCalledTimes(1);
  });
  it('opens and focuses a page exactly once and retains its metadata', async () => {
    await harness.run(state => state.loadPage(PAGE_ID));
    expect(harness.current.tabs).toEqual([{ id: PAGE_ID, title: 'Page', content: 'body', metadata: DETAIL.metadata, isTable: false }]);
    expect(harness.current.activeTableId).toBeNull();
    expect(harness.current.viewMode).toBe('editor');
  });
  it('returns closing PDFs to their remembered tab and removes orphan split panes', async () => {
    await harness.run(state => {
      state.setTabs([{ id: PAGE_ID, title: 'Origin', content: 'body' }, { id: 'pdf', title: 'PDF', isPdf: true, origin: { tableId: null, tabId: PAGE_ID, viewId: null } }]);
      state.setActiveTabId('pdf');
      state.setSplitTabIds([PAGE_ID]);
    });
    await harness.run(state => { state.handleTabClose('pdf'); });
    expect(harness.current.activeTabId).toBe(PAGE_ID);
    expect(harness.current.splitTabIds).toEqual([]);
  });
  it('returns closing PDFs to their exact table view when no origin tab remains', async () => {
    await harness.run(state => {
      state.setRegistry(CATALOG);
      state.setTabs([{ id: 'pdf', title: 'PDF', isPdf: true, origin: { tableId: 'table', tabId: null, viewId: 'specific' } }]);
      state.setActiveTabId('pdf');
      state.setSplitTabIds([OTHER_ID]);
    });
    await harness.run(state => { state.handleTabClose('pdf'); });
    expect(harness.current.activeTableId).toBe('table');
    expect(harness.current.activeViewId).toBe('specific');
    expect(harness.current.viewMode).toBe('table');
    expect(harness.current.splitTabIds).toEqual([]);
  });
  it('preserves the four-pane ceiling', async () => {
    await harness.run(state => {
      state.setActiveTabId(PAGE_ID);
      state.setSplitTabIds(['a', 'b']);
      state.setSplitTableIds(['table']);
    });
    await harness.run(state => { state.handleToggleSplit('c'); });
    expect(harness.current.splitTabIds).toEqual(['a', 'b']);
  });
});
describe('table and view selection', () => {
  it('does not auto-create views before registry loading has finished', async () => {
    await harness.run(state => { state.setRegistry({ ...CATALOG, views: [] }); });
    await harness.run(state => state.handleTableSelect('table'));
    expect(views.createVaultView).not.toHaveBeenCalled();
    expect(harness.current.schema.Status_config).toEqual({ id: 'fld_status' });
  });
  it('creates the canonical main view once, with the legacy payload and order', async () => {
    await harness.run(state => { state.setRegistry({ ...CATALOG, views: [] }); state.setIsRegistryLoading(false); });
    await harness.run(async state => { await state.handleTableSelect('table'); await state.handleTableSelect('table'); });
    expect(views.createVaultView).toHaveBeenCalledTimes(1);
    expect(views.createVaultView).toHaveBeenCalledWith(expect.objectContaining({ table_id: 'table', name: 'Table', type: 'table', visibleProperties: ['title', 'Status'], is_main: true, filters: [], filterTree: null }));
  });
  it('arms record focus restoration only when returning through its table breadcrumb', async () => {
    await harness.run(state => { state.setTabs([{ id: PAGE_ID, title: 'Page', content: 'body' }]); state.setRegistry(CATALOG); });
    await harness.run(state => state.openRecordFromView(PAGE_ID, 'table', 'main', { returnFocusId: PAGE_ID }));
    expect(harness.current.recordReturnFocus?.isArmed).toBe(false);
    await harness.run(state => { state.returnToTableFromBreadcrumb('table', 'main'); });
    expect(harness.current.recordReturnFocus).toEqual({ recordId: PAGE_ID, tableId: 'table', viewId: 'main', requestId: 1, isArmed: true });
  });
  it('deduplicates resource titles but leaves other tables untouched', () => {
    const pages = [{ ...PAGE, title: 'À title!', metadata: { table_id: 'resources' } }, { ...PAGE, id: OTHER_ID, title: 'A title', last_modified: '2026-02-01', metadata: { table_id: 'resources' } }];
    expect(harness.current.getVisibleTableRecords(pages, 'resources').map(page => page.id)).toEqual([OTHER_ID]);
    expect(harness.current.getVisibleTableRecords(pages.map(page => ({ ...page, metadata: { table_id: 'table' } })), 'table')).toHaveLength(2);
  });
});
