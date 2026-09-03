import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vault from '../../../shared/api/vaults';
import * as views from '../../../shared/api/vault-views';
import { fetchBrainTableStatus } from '../../../shared/api/brain';
import { fetchReferenceTable } from '../../../shared/api/literature-resources';
import { emitCancelableAppEvent } from '../../../shared/platform/app-events';
import { dispatchWindowEvent } from '../../../shared/platform/browser-events';
import { tableBodyCallbacks } from './table-callbacks';
import { PAGE_ID, OTHER_ID, installApiDefaults } from './test-support';
import { renderController } from './__tests__/controller-support';
vi.mock('../../../shared/api/vaults');
vi.mock('../../../shared/api/vault-views');
vi.mock('../../../shared/api/brain');
vi.mock('../../../shared/api/literature-resources');
vi.mock('../../../shared/api/resource-processing');
let harness: Awaited<ReturnType<typeof renderController>> | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  installApiDefaults();
  vi.mocked(fetchBrainTableStatus).mockRejectedValue(new Error('disabled fixture'));
  vi.mocked(fetchReferenceTable).mockRejectedValue(new Error('disabled fixture'));
});
afterEach(async () => { await harness?.unmount(); });
describe('dashboard lifecycle and integrations', () => {
  it('loads the initial catalog once and exposes a rendered controller state', async () => {
    harness = await renderController();
    expect(harness.container.textContent).toBe('editor');
    expect(vault.fetchVaultPages).toHaveBeenCalledTimes(1);
    expect(vault.fetchVaultRegistry).toHaveBeenCalledTimes(1);
    expect(harness.current.loading).toBe(false);
  });
  it('does not duplicate initial catalogs when StrictMode replays mount effects', async () => {
    harness = await renderController('', undefined, true);
    expect(vault.fetchVaultPages).toHaveBeenCalledTimes(1);
    expect(vault.fetchVaultRegistry).toHaveBeenCalledTimes(1);
    expect(harness.current.loading).toBe(false);
    expect(harness.current.isRegistryLoading).toBe(false);
  });
  it('restores a direct table route with its schema without creating duplicate views', async () => {
    harness = await renderController('table/table/view/main');
    expect(harness.current.activeTableId).toBe('table');
    expect(harness.current.activeViewId).toBe('main');
    expect(harness.current.schema.Status_config).toEqual({ id: 'fld_status' });
    expect(views.createVaultView).not.toHaveBeenCalled();
  });
  it('opens a direct page without pruning its newly loaded tab', async () => {
    harness = await renderController(`page/${PAGE_ID}`);
    expect(harness.current.activeTabId).toBe(PAGE_ID);
    expect(harness.current.tabs[0]?.content).toBe('body');
    expect(vault.saveVaultPage).not.toHaveBeenCalled();
  });
  it('preserves keyboard routing: Alt+K opens search, Cmd+K remains available to the editor', async () => {
    harness = await renderController();
    const editorShortcut = new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true });
    await act(async () => { dispatchWindowEvent(editorShortcut); await Promise.resolve(); });
    expect(editorShortcut.defaultPrevented).toBe(false);
    expect(harness.current.isGlobalSearchOpen).toBe(false);
    const globalShortcut = new KeyboardEvent('keydown', { key: 'k', altKey: true, cancelable: true });
    await act(async () => { dispatchWindowEvent(globalShortcut); await Promise.resolve(); });
    expect(globalShortcut.defaultPrevented).toBe(true);
    expect(harness.current.isGlobalSearchOpen).toBe(true);
    await act(async () => { dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await Promise.resolve(); });
    expect(harness.current.isGlobalSearchOpen).toBe(false);
  });
  it('reopens one document tab while refreshing its location and navigation origin', async () => {
    harness = await renderController();
    await harness.run(state => { state.setActiveTableId('table'); state.setActiveViewId('main'); });
    const detail = { documentKey: 'fixture', src: '/synthetic.pdf', title: 'Document', kind: 'pdf' as const, location: { pageNumber: 1 } };
    let accepted = true;
    await act(async () => { accepted = emitCancelableAppEvent('gnosi:open-pdf', detail); await Promise.resolve(); });
    expect(accepted).toBe(false);
    expect(harness.current.tabs[0]?.origin).toEqual({ tableId: 'table', viewId: 'main', tabId: null });
    await harness.run(state => { state.setActiveTabId(OTHER_ID); state.setActiveTableId(null); });
    await act(async () => { emitCancelableAppEvent('gnosi:open-pdf', { ...detail, location: { pageNumber: 4 } }); await Promise.resolve(); });
    expect(harness.current.tabs).toHaveLength(1);
    expect(harness.current.tabs[0]?.location).toEqual({ pageNumber: 4 });
    expect(harness.current.tabs[0]?.origin?.tabId).toBe(OTHER_ID);
  });
  it('keeps table refresh promises and record-open context intact across the typed callback boundary', async () => {
    harness = await renderController();
    const callbacks = tableBodyCallbacks(harness.current, 'table', 'main', false);
    await harness.run(async () => { const saved = callbacks.onCellSaved(); expect(saved).toBeInstanceOf(Promise); await saved; });
    await harness.run(() => callbacks.onNoteSelect(PAGE_ID, { returnFocusId: PAGE_ID }));
    expect(harness.current.recordReturnFocus?.viewId).toBe('main');
  });
});
