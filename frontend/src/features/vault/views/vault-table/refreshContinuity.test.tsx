import { PaneVisibilityContext } from '../../../../shared/ui/PaneVisibility';
import { act, useLayoutEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../tests/mount-react';
import { useTableController, type TableController } from './useTableController';
import { TableLayout } from './TableLayout';
import { keyboardOwnership } from './keyboardOwnership';
import type { TableNote, VaultTableProps } from './types';
import type { TableVirtualizerOptions } from './tableVirtualizerStore';
const fixture = vi.hoisted(() => ({
  t: (key: string, fallback?: unknown): string => typeof fallback === 'string' ? fallback : key,
  emptyVirtualRows: false,
  isEnabled: () => false, getSettings: () => ({}),
  virtualizer: { scrollToIndex: vi.fn(), measureElement: vi.fn() },
  preview: { close: vi.fn(), getTitleProps: () => ({}), active: null, preview: null, openForKeyboard: vi.fn() },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: fixture.t, i18n: { language: 'en' } }) }));
vi.mock('./useTableVirtualizer', () => ({ useTableVirtualizer: (options: TableVirtualizerOptions) => ({
  rowVirtualizer: fixture.virtualizer, virtTotalSize: options.count * 56,
  virtualRows: Array.from({ length: fixture.emptyVirtualRows ? 0 : options.count }, (_, index) => ({ index, key: options.getItemKey?.(index) ?? index, start: index * 56, end: (index + 1) * 56, size: 56, lane: 0 })),
}) }));
vi.mock('../../../../shared/plugins/usePlugins', () => ({ usePlugins: () => ({ isEnabled: fixture.isEnabled, getPluginSettings: fixture.getSettings }) }));
vi.mock('../../../../shared/auth/auth-context', () => ({ useAuth: () => ({ user: { name: 'Fixture' } }) }));
vi.mock('../../../../shared/i18n/useLocaleSettings', () => ({ useLocaleSettings: () => ({ numberLocale: 'en-US', dateLocale: 'en-US' }) }));
vi.mock('../../../../shared/editor/useTitlePreview', () => ({ useTitlePreview: () => fixture.preview }));
vi.mock('../../../../shared/api/vault-table', () => ({ patchVaultTablePage: vi.fn(), createVaultTablePage: vi.fn(), executeVaultTableButtonAction: vi.fn() }));
vi.mock('../../../../shared/api/transports', () => ({ transportFetch: vi.fn() }));
vi.mock('../../../../shared/api/brain', () => ({ fetchLlmWikiConfig: vi.fn() }));
vi.mock('../../../../shared/api/vault-schema', () => ({ fetchOptionCatalogs: vi.fn(), removeTableOption: vi.fn() }));
vi.mock('../../../../shared/notifications/notifyError', () => ({ notifyError: vi.fn() }));
vi.mock('../../../../shared/notifications/toast', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
const cleanups: (() => void)[] = [];
const frames: FrameRequestCallback[] = [];
const row = (id: string): TableNote => ({ id, title: id, metadata: { Text: `value-${id}`, table_id: 'table' } });
const rows = [row('a'), row('b'), row('c')] as const;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); frames.length = 0; fixture.emptyVirtualRows = false;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
  keyboardOwnership.owner = null;
});
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });
function mountTable(extra: Partial<VaultTableProps> = {}) {
  let model: TableController | undefined;
  const props: VaultTableProps = { notes: rows, schema: { Text: 'text' }, activeView: { id: 'view', table_id: 'table', sorts: [], visibleProperties: ['title', 'Text'] }, onNoteSelect: vi.fn(), ...extra };
  function Probe({ input }: { input: VaultTableProps }) {
    const current = useTableController(input); useLayoutEffect(() => { model = current; });
    return <TableLayout model={current} />;
  }
  const tree = (input: VaultTableProps, visible = true) => <PaneVisibilityContext.Provider value={visible}><Probe input={input} /></PaneVisibilityContext.Provider>;
  const mounted = mountTestComponent(tree(props)); cleanups.push(mounted.unmount);
  return { ...mounted, model: () => { if (!model) throw new Error('Missing table model'); return model; },
    refresh: (next: Partial<VaultTableProps>, visible = true) => { mounted.render(tree({ ...props, ...next }, visible)); } };
}
function viewport(container: HTMLElement) {
  const found = container.querySelector<HTMLElement>('[data-vault-table-scroll]');
  if (!found) throw new Error('Missing table viewport'); return found;
}
it('keeps the loaded window, selected column and scroll when unrelated records are inserted', () => {
  const original = Array.from({ length: 160 }, (_, index) => row(`row-${String(index)}`));
  const table = mountTable({ notes: original });
  act(() => { table.model().setVisibleRowsCount(150); table.model().setActiveCell({ rowId: 'row-120', field: 'Text' }); });
  const scroll = viewport(table.container); scroll.scrollTop = 6200; scroll.scrollLeft = 175;
  table.refresh({ notes: [row('new'), ...original] });
  expect(table.model().visibleRowsCount).toBe(150);
  expect(table.model().activeCell).toEqual({ rowId: 'row-120', field: 'Text' });
  expect(table.model().navRowIndexById.has('row-120')).toBe(true);
  expect(scroll.scrollTop).toBe(6200); expect(scroll.scrollLeft).toBe(175);
});
it('preserves a surviving input, focus and caret when refreshed records reorder', () => {
  const table = mountTable();
  act(() => { table.model().setActiveCell({ rowId: 'b', field: 'Text' }); table.model().setEditingCell({ rowId: 'b', field: 'Text', originalMetaKey: 'Text' }); });
  const selector = '[data-grid-row="b"][data-grid-field="Text"] input, [data-grid-row="b"][data-grid-field="Text"] textarea';
  const input = table.container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!input) throw new Error('Missing cell editor'); input.focus(); input.setSelectionRange(1, 4);
  table.refresh({ notes: [rows[2], rows[0], { ...rows[1], title: 'Renamed' }] });
  expect(table.container.querySelector(selector)).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(1); expect(input.selectionEnd).toBe(4);
  expect(table.model().noteById.get('b')?.title).toBe('Renamed');
});
it('loads the new batch containing an active record moved by refreshed values', () => {
  const original = Array.from({ length: 160 }, (_, index) => row(`row-${String(index)}`));
  const table = mountTable({ notes: original });
  act(() => { table.model().setActiveCell({ rowId: 'row-0', field: 'Text' }); });
  table.refresh({ notes: [...original].reverse() });
  expect(table.model().activeCell).toEqual({ rowId: 'row-0', field: 'Text' });
  expect(table.model().navRowIndexById.has('row-0')).toBe(true);
  expect(table.model().visibleRowsCount).toBe(200);
});
it('falls back within a surviving column when the selected record disappears, without stealing editor focus', () => {
  const table = mountTable();
  act(() => { table.model().setActiveCell({ rowId: 'b', field: 'Text' }); });
  const outside = document.createElement('input'); document.body.appendChild(outside); cleanups.push(() => { outside.remove(); });
  outside.focus(); table.refresh({ notes: [rows[0], rows[2]] });
  expect(table.model().activeCell).toEqual({ rowId: 'a', field: 'Text' });
  expect(document.activeElement).toBe(outside);
});
it('returns to an already retained cell and range without centering or changing either scroll axis', () => {
  const restored = vi.fn(); const table = mountTable({ onRecordFocusRestored: restored });
  act(() => { table.model().setActiveCell({ rowId: 'b', field: 'Text' }); table.model().setAnchorCell({ rowId: 'a', field: 'Text' }); });
  const scroll = viewport(table.container); scroll.scrollTop = 84; scroll.scrollLeft = 130;
  fixture.virtualizer.scrollToIndex.mockClear();
  table.refresh({ restoreRecordFocus: { recordId: 'b', requestId: 'return' } });
  expect(table.model().activeCell).toEqual({ rowId: 'b', field: 'Text' });
  expect(table.model().anchorCell).toEqual({ rowId: 'a', field: 'Text' });
  expect(fixture.virtualizer.scrollToIndex).not.toHaveBeenCalled();
  expect(scroll.scrollTop).toBe(84); expect(scroll.scrollLeft).toBe(130);
  expect(restored).toHaveBeenCalledWith('return');
  const outside = document.createElement('textarea'); document.body.appendChild(outside); cleanups.push(() => { outside.remove(); });
  outside.focus(); for (const frame of frames.splice(0)) frame(0);
  expect(document.activeElement).toBe(outside);
});

it('clears both cell references when the last record is removed and consumes its return request', () => {
  const restored = vi.fn(); const table = mountTable({ notes: [rows[0]], onRecordFocusRestored: restored });
  act(() => { table.model().setActiveCell({ rowId: 'a', field: 'Text' }); table.model().setAnchorCell({ rowId: 'a', field: 'title' }); });
  table.refresh({ notes: [], restoreRecordFocus: { recordId: 'a', requestId: 'deleted' } });
  expect(table.model().activeCell).toBeNull(); expect(table.model().anchorCell).toBeNull();
  expect(restored).toHaveBeenCalledExactlyOnceWith('deleted');
});

it('keeps virtualized space available while the hidden viewport has no measured rows', () => {
  const table = mountTable();
  fixture.emptyVirtualRows = true;
  table.refresh({ notes: [...rows] });
  const spacer = table.container.querySelector<HTMLTableCellElement>('tr[aria-hidden="true"] td');
  expect(spacer?.style.height).toBe(`${String(rows.length * 56)}px`);
});

it('does not run queued focus restoration after its pane becomes inactive', () => {
  const table = mountTable();
  act(() => { table.model().setActiveCell({ rowId: 'b', field: 'Text' }); });
  table.refresh({ restoreRecordFocus: { recordId: 'b', requestId: 'queued-return' } });
  viewport(table.container).focus();
  table.refresh({}, false);
  const focus = vi.spyOn(viewport(table.container), 'focus');
  for (const frame of frames.splice(0)) frame(0);
  expect(focus).not.toHaveBeenCalled();
});
