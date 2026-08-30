import { act, useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../test/mount-react';
import { emitAppEvent } from '../../../shared/platform/app-events';
import { dispatchWindowEvent } from '../../../shared/platform/browser-events';
import { patchVaultTablePage, createVaultTablePage, executeVaultTableButtonAction } from '../../../shared/api/vault-table';
import { transportFetch } from '../../../shared/api/transports';
import { keyboardOwnership } from './keyboardOwnership';
import type { TableNote, VaultTableProps } from './types';
import { useTableController, type TableController } from './useTableController';

const fixture = vi.hoisted(() => ({
  t: (key: string, fallback?: unknown): string => typeof fallback === 'string' ? fallback : key,
  isEnabled: () => false,
  getSettings: () => ({}),
  virtualizer: { getVirtualItems: () => [], getTotalSize: () => 0, scrollToIndex: vi.fn(), measureElement: vi.fn() },
  preview: { close: vi.fn(), getTitleProps: () => ({}), active: null, preview: null, openForKeyboard: vi.fn() },
  locale: { numberLocale: 'en-US', dateLocale: 'en-US' },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: fixture.t, i18n: { language: 'en' } }) }));
vi.mock('./useTableVirtualizer', () => ({ useTableVirtualizer: () => ({ rowVirtualizer: fixture.virtualizer, virtualRows: [], virtTotalSize: 0 }) }));
vi.mock('../../../plugins/usePlugins', () => ({ usePlugins: () => ({ isEnabled: fixture.isEnabled, getPluginSettings: fixture.getSettings }) }));
vi.mock('../../../context/auth-context', () => ({ useAuth: () => ({ user: { name: 'Fixture' } }) }));
vi.mock('../../../hooks/useLocaleSettings', () => ({ useLocaleSettings: () => fixture.locale }));
vi.mock('../useTitlePreview', () => ({ useTitlePreview: () => fixture.preview }));
vi.mock('../../../shared/api/vault-table', () => ({ patchVaultTablePage: vi.fn(), createVaultTablePage: vi.fn(), executeVaultTableButtonAction: vi.fn() }));
vi.mock('../../../shared/api/transports', () => ({ transportFetch: vi.fn() }));
vi.mock('../../../shared/api/brain', () => ({ fetchLlmWikiConfig: vi.fn() }));
vi.mock('../../../shared/api/vault-schema', () => ({ fetchOptionCatalogs: vi.fn(), removeTableOption: vi.fn() }));
vi.mock('../../../lib/notifyError', () => ({ notifyError: vi.fn() }));
vi.mock('../../../lib/toast', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const schema = { Status: 'status', Score: 'number', Text: 'text', Period: 'period', Tags: 'multi_select', Ref: 'relation', Formula: 'formula', Formula_config: { formula: '{Score}*2' } };
const notes: readonly TableNote[] = [
  { id: 'parent', title: 'Parent', metadata: { table_id: 'fixture', Status: 'Todo', Score: 2 } },
  { id: 'a', title: 'Alpha', metadata: { table_id: 'fixture', parent_id: 'parent', Status: 'Done', Score: 3, Text: 'alpha', Tags: ['a'], Ref: ['r'] } },
  { id: 'b', title: 'Beta', metadata: { table_id: 'fixture', parent_id: 'parent', Status: 'Todo', Score: 5, Text: 'beta' } },
];
function mountController(extra: Partial<VaultTableProps> = {}) {
  let current: TableController | undefined;
  const props: VaultTableProps = { notes, schema, activeView: { id: 'fixture-view', table_id: 'fixture', sorts: [] }, onNoteSelect: vi.fn(), ...extra };
  function Probe({ input }: { input: VaultTableProps; }) {
    const model = useTableController(input);
    useLayoutEffect(() => { current = model; });
    return <div ref={model.tableContainerRef} />;
  }
  const mounted = mountTestComponent(<Probe input={props} />);
  return {
    ...mounted,
    model: () => { if (!current) throw new Error('Controller was not mounted'); return current; },
    rerender: (input: Partial<VaultTableProps>) => { mounted.render(<Probe input={{ ...props, ...input }} />); },
  };
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
  vi.clearAllMocks();
  keyboardOwnership.owner = null;
  vi.mocked(patchVaultTablePage).mockResolvedValue({ id: 'fixture', title: '', content: '', folder: '', message: '', metadata: {}, status: 'success' });
  vi.mocked(transportFetch).mockResolvedValue(new Response('{}', { status: 200 }));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('VaultTable controller contracts', () => {
  it('keeps the public title column fixed and excludes button fields', () => {
    const table = mountController({ schema: { Title: 'title', Status: 'status', Act: 'button' }, activeView: { visibleProperties: ['title', 'Status', 'Act'] } });
    expect(table.model().gridColumns).toEqual([{ key: 'title', type: 'title' }, { key: 'Status', type: 'status' }]);
    expect(table.model().showModifiedColumn).toBe(false);
  });
  it('applies optimistic metadata, preserves unrelated fields and reconciles fresh props', async () => {
    const refresh = vi.fn(); const table = mountController({ onCellSaved: refresh });
    await act(async () => { expect(await table.model().handleCellSave('a', 'Text', 'updated', 'Text')).toBe(true); });
    expect(patchVaultTablePage).toHaveBeenCalledWith('a', { metadata: { Text: 'updated' } });
    expect(table.model().noteById.get('a')?.metadata).toMatchObject({ Text: 'updated', Score: 3 });
    table.rerender({ notes: notes.map(n => n.id === 'a' ? { ...n, metadata: { ...n.metadata, Text: 'updated' } } : n) });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(table.model().noteById.get('a')?.metadata?.Text).toBe('updated');
  });
  it('rolls back a rejected cell without discarding another optimistic field', async () => {
    const table = mountController();
    await act(async () => { await table.model().handleCellSave('a', 'Text', 'pending', 'Text'); });
    vi.mocked(patchVaultTablePage).mockRejectedValueOnce(new Error('fixture offline'));
    await act(async () => { expect(await table.model().handleCellSave('a', 'Score', 9, 'Score')).toBe(false); });
    expect(table.model().noteById.get('a')?.metadata).toMatchObject({ Text: 'pending', Score: 3 });
  });
  it('uses all children for completion propagation, including filtered siblings', async () => {
    const table = mountController({ searchTerm: 'Beta', activeView: { id: 'fixture', sorts: [], enableSubitems: true } });
    await act(async () => { await table.model().handleCellSave('b', 'Status', 'Done', 'Status'); });
    expect(patchVaultTablePage).toHaveBeenCalledWith('parent', { metadata: { Status: 'Done' } });
  });
  it('does not complete the parent while an unfiltered sibling remains incomplete', async () => {
    const table = mountController({ notes: notes.map(n => n.id === 'a' ? { ...n, metadata: { ...n.metadata, Status: 'Todo' } } : n) });
    await act(async () => { await table.model().handleCellSave('b', 'Status', 'Done', 'Status'); });
    expect(patchVaultTablePage).toHaveBeenCalledTimes(1);
  });
  it('preserves automatic period boundaries across sibling updates', async () => {
    const rows = notes.map(n => ({ ...n, metadata: { ...n.metadata, Period: n.id === 'a' ? { start: '2026-08-01', end: '2026-08-05' } : { start: '2026-08-03', end: '2026-08-07' } } }));
    const table = mountController({ notes: rows, activeView: { id: 'fixture-period', sorts: [], enableSubitems: true } });
    await act(async () => { await table.model().handleCellSave('b', 'Period', { start: '2026-08-02', end: '2026-08-09' }, 'Period'); });
    const parentPatch = vi.mocked(patchVaultTablePage).mock.calls.find(call => call[0] === 'parent');
    expect(parentPatch?.[1].metadata.Period).toMatchObject({ start: '2026-08-01', end: '2026-08-09' });
  });
  it('copies a rectangular selection as TSV without serializing computed cells into metadata', async () => {
    const writeText = vi.fn<() => Promise<void>>().mockResolvedValue();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const table = mountController();
    act(() => { table.model().setActiveCell({ rowId: 'a', field: 'Text' }); });
    act(() => { table.model().handleCopyCells(); });
    expect(writeText).toHaveBeenCalledWith('alpha');
    act(() => { table.model().setActiveCell({ rowId: 'b', field: 'Text' }); });
    await act(async () => { await table.model().handlePasteCells(); });
    expect(transportFetch).toHaveBeenCalledWith('/api/vault/pages/b', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ metadata: { Text: 'alpha' } }) }));
  });
  it('uses title-only PATCH and rolls back title failures', async () => {
    const table = mountController();
    await act(async () => { await table.model().saveTitle('a', '  Renamed  '); });
    expect(transportFetch).toHaveBeenCalledWith('/api/vault/pages/a', expect.objectContaining({ body: '{"title":"Renamed"}' }));
    expect(table.model().noteById.get('a')?.title).toBe('Renamed');
    vi.mocked(transportFetch).mockResolvedValueOnce(new Response('{"detail":"failure"}', { status: 500 }));
    await act(async () => { await table.model().saveTitle('b', 'Fail'); });
    expect(table.model().noteById.get('b')?.title).toBe('Beta');
  });
  it('only lets the last interacted table process global keyboard edits', async () => {
    const first = mountController(); const second = mountController();
    act(() => { first.model().setActiveCell({ rowId: 'a', field: 'Text' }); second.model().setActiveCell({ rowId: 'b', field: 'Text' }); second.model().claimKeyboard(); });
    await act(async () => { dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })); await Promise.resolve(); });
    expect(transportFetch).toHaveBeenCalledTimes(1);
    expect(transportFetch).toHaveBeenCalledWith('/api/vault/pages/b', expect.anything());
  });
  it('blocks keyboard mutations while a modal owns the UI', () => {
    const table = mountController();
    act(() => { table.model().setActiveCell({ rowId: 'a', field: 'Text' }); });
    document.body.classList.add('gnosi-modal-open');
    try { act(() => { dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'Delete' })); }); }
    finally { document.body.classList.remove('gnosi-modal-open'); }
    expect(transportFetch).not.toHaveBeenCalled();
  });
  it('applies the typed relation history event and cleans up on unmount', () => {
    const table = mountController();
    act(() => { emitAppEvent('gnosi:relation-value-applied', { pageId: 'a', metadataKey: 'Ref', value: ['restored'] }); });
    expect(table.model().noteById.get('a')?.metadata?.Ref).toEqual(['restored']);
    table.unmount();
    act(() => { emitAppEvent('gnosi:relation-value-applied', { pageId: 'a', metadataKey: 'Ref', value: [] }); });
    expect(patchVaultTablePage).not.toHaveBeenCalled();
  });
  it('keeps new-record metadata and focus callback payloads unchanged', async () => {
    vi.mocked(createVaultTablePage).mockResolvedValueOnce({ id: 'created', title: 'New record', content: '', folder: '', message: '', metadata: {}, status: 'success' });
    const onNoteSelect = vi.fn(); const table = mountController({ onNoteSelect });
    act(() => { table.model().setNewRowTitle('  New record  '); });
    await act(async () => { await table.model().handleCreateRowRecord(); });
    expect(vi.mocked(createVaultTablePage).mock.calls[0]?.[0]).toMatchObject({ title: 'New record', content: '', metadata: { table_id: 'fixture', database_table_id: 'fixture' } });
    expect(onNoteSelect).toHaveBeenCalledWith('created', { returnFocusId: 'created' });
  });
  it('evaluates formula metadata and rollups without changing the ordinary aggregation fallback', () => {
    const table = mountController({ allNotes: notes, schema: { ...schema, Rollup: 'rollup', Rollup_config: { relationField: 'Ref', targetProperty: 'Score', aggregation: 'sum' } }, notes: notes.map(n => n.id === 'a' ? { ...n, metadata: { ...n.metadata, Ref: ['parent', 'b'] } } : n) });
    const alpha = table.model().noteById.get('a');
    if (!alpha) throw new Error('Missing alpha');
    expect(table.model().getCalculatedFieldValue('Formula', alpha)).toBe(6);
    expect(table.model().getCalculatedFieldValue('Rollup', alpha)).toBe(7);
    act(() => { table.model().setAggregations({ Formula: 'sum', Score: 'sum' }); });
    expect(table.model().calculateAggregation('Formula', 'formula')).toBe('20');
    // Existing undefined -> default-null fallback: do not repair aggregation semantics in a type migration.
    expect(table.model().calculateAggregation('Score', 'number')).toBe(0);
  });
  it('groups multi-cell paste into one PATCH per page and only rolls back the rejected page', async () => {
    vi.stubGlobal('navigator', { clipboard: { readText: vi.fn().mockResolvedValue('12\tchanged a\n15\tchanged b') } });
    const table = mountController({ schema: { Score: 'number', Text: 'text' } });
    act(() => { table.model().setActiveCell({ rowId: 'a', field: 'Score' }); table.model().setAnchorCell({ rowId: 'b', field: 'Text' }); });
    vi.mocked(transportFetch).mockResolvedValueOnce(new Response('{}', { status: 200 })).mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await act(async () => { await table.model().handlePasteCells(); });
    expect(transportFetch).toHaveBeenCalledTimes(2);
    expect(transportFetch).toHaveBeenCalledWith('/api/vault/pages/a', expect.objectContaining({ body: '{"metadata":{"Score":12,"Text":"changed a"}}' }));
    expect(table.model().noteById.get('a')?.metadata).toMatchObject({ Score: 12, Text: 'changed a' });
    expect(table.model().noteById.get('b')?.metadata).toMatchObject({ Score: 5, Text: 'beta' });
  });
  it('propagates a bulk completion using the successful sibling overrides together', async () => {
    vi.stubGlobal('navigator', { clipboard: { readText: vi.fn().mockResolvedValue('Done') } });
    const table = mountController({ notes: notes.map(n => ({ ...n, metadata: { ...n.metadata, Status: 'Todo' } })), schema: { Status: 'status', Status_config: { options: ['Todo', 'Done'] } }, activeView: { id: 'bulk', enableSubitems: true } });
    act(() => { table.model().setExpandedRows(new Set(['parent'])); });
    act(() => { table.model().setActiveCell({ rowId: 'a', field: 'Status' }); table.model().setAnchorCell({ rowId: 'b', field: 'Status' }); });
    await act(async () => { await table.model().handlePasteCells(); });
    expect(transportFetch).toHaveBeenCalledTimes(2);
    expect(patchVaultTablePage).toHaveBeenCalledWith('parent', { metadata: { Status: 'Done' } });
  });
  it('does not enter an editor or paste into a calculated cell', async () => {
    vi.stubGlobal('navigator', { clipboard: { readText: vi.fn().mockResolvedValue('99') } });
    const table = mountController();
    act(() => { table.model().setActiveCell({ rowId: 'a', field: 'Formula' }); });
    act(() => { table.model().beginEditActive(null); });
    await act(async () => { await table.model().handlePasteCells(); });
    expect(table.model().editingCell).toBeNull();
    expect(transportFetch).not.toHaveBeenCalled();
    expect(patchVaultTablePage).not.toHaveBeenCalled();
  });
  it('keeps selection callback Sets and clears selection after bulk actions', () => {
    const onDeleteSelected = vi.fn(); const onApplyTemplate = vi.fn();
    const table = mountController({ onDeleteSelected, onApplyTemplate });
    act(() => { table.model().selectAll(['a', 'b']); });
    act(() => { table.model().handleApplyTemplate('template'); });
    expect(onApplyTemplate).toHaveBeenCalledWith(new Set(['a', 'b']), 'template');
    expect(table.model().selectedIds.size).toBe(0);
    act(() => { table.model().toggleSelect('a'); });
    act(() => { table.model().handleBulkDelete(); });
    expect(onDeleteSelected).toHaveBeenCalledWith(new Set(['a']));
    expect(table.model().selectedIds.size).toBe(0);
  });
  it('preserves media targeting and canonical file-field configuration', () => {
    const table = mountController({ schema: { Files: 'files', Files_config: { storage_folder: 'Assets', name_pattern: '{title}', file_mode: 'upload' } } });
    const alpha = notes[1];
    if (!alpha) throw new Error('Missing alpha');
    act(() => { table.model().openMediaPicker(alpha, 'Files', 'files'); });
    expect(table.model().mediaPickerCell).toMatchObject({ rowId: 'a', field: 'Files', originalMetaKey: 'Files', tableId: 'fixture', imageField: false, fileField: { propertyName: 'Files', storageFolder: 'assets', namePattern: '{title}', fileMode: 'upload' } });
    expect(table.model().urlToVaultPath('/api/vault/assets/sample.png?vault=fixture')).toBe('sample.png');
  });
  it('uses the existing normalized resource payload without opening a real resource', async () => {
    const table = mountController();
    const note = { id: 'resource', metadata: { 'Zotero uri': 'zotero://select/items/FIXTURE', Adjunts: ['fixture.pdf'] } };
    expect(table.model().hasOpenableResource(note)).toBe(true);
    await act(async () => { await table.model().handleOpenExternalResource(note); });
    expect(transportFetch).toHaveBeenCalledWith('/api/vault/open-resource', expect.objectContaining({ method: 'POST', body: '{"zotero_uri":"zotero://select/items/FIXTURE","file_path":null,"attachments":["fixture.pdf"]}' }));
    expect(table.model().openingResourceId).toBeNull();
  });
  it('routes confirmation actions to the modal and preserves plugin execution payloads', async () => {
    const onTranslated = vi.fn(); const table = mountController({ onTranslated });
    const note = notes[1];
    if (!note) throw new Error('Missing alpha');
    await act(async () => { await table.model().executeTableFunctionality(null, note, { id: 'translate', label: 'Translate', action: 'translate_row', enabled: true, config: { target: 'ca' } }); });
    expect(table.model().pendingAction).toMatchObject({ noteId: 'a', action: 'translate_row', fieldConfig: { button_action: 'translate_row', button_config: { target: 'ca' } } });
    expect(executeVaultTableButtonAction).not.toHaveBeenCalled();
    vi.mocked(executeVaultTableButtonAction).mockResolvedValueOnce({ status: 'ok' });
    await act(async () => { await table.model().executeTableFunctionality(null, note, { id: 'skill', label: 'Skill', action: 'run_skill', enabled: true, config: { skill: 'fixture' } }); });
    expect(executeVaultTableButtonAction).toHaveBeenCalledWith({ note_id: 'a', button_action: 'run_skill', button_config: { skill: 'fixture' } });
    expect(onTranslated).toHaveBeenCalledWith({});
    expect(table.model().executingButtonKey).toBeNull();
  });
  it('retires only acknowledged title overrides and preserves pending titles through empty input', async () => {
    const table = mountController();
    await act(async () => { await table.model().saveTitle('a', 'Pending Alpha'); await table.model().saveTitle('b', 'Pending Beta'); });
    table.rerender({ notes: [] });
    expect(table.model().safeNotes).toHaveLength(0);
    table.rerender({ notes });
    expect(table.model().noteById.get('a')?.title).toBe('Pending Alpha');
    expect(table.model().noteById.get('b')?.title).toBe('Pending Beta');
    table.rerender({ notes: notes.map(note => note.id === 'a' ? { ...note, title: 'Pending Alpha' } : note) });
    table.rerender({ notes: notes.map(note => note.id === 'a' ? { ...note, title: 'Later server title' } : note) });
    expect(table.model().noteById.get('a')?.title).toBe('Later server title');
    expect(table.model().noteById.get('b')?.title).toBe('Pending Beta');
  });
  it('preserves drafts and row selection while view/input resets clear only their existing navigation state', () => {
    const table = mountController();
    act(() => {
      table.model().setNewRowTitle('Unsent');
      table.model().selectAll(['a', 'b']);
      table.model().setActiveCell({ rowId: 'b', field: 'Text' });
      table.model().setAnchorCell({ rowId: 'a', field: 'Text' });
      table.model().setExpandedGroups(new Set(['Done']));
      table.model().setVisibleRowsCount(150);
    });
    table.rerender({ notes: [], activeView: undefined });
    expect(table.model().newRowTitle).toBe('Unsent');
    expect(table.model().selectedIds).toEqual(new Set(['a', 'b']));
    expect(table.model().expandedGroups.size).toBe(0);
    expect(table.model().visibleRowsCount).toBe(50);
    table.rerender({ notes, activeView: { id: 'replacement', columnWidths: { title: 380 } } });
    expect(table.model().columnWidths.title).toBe(380);
    expect(table.model().activeCell).toEqual({ rowId: 'b', field: 'Text' });
    expect(table.model().anchorCell).toBeNull();
    expect(table.model().selectedIds).toEqual(new Set(['a', 'b']));
    expect(table.model().newRowTitle).toBe('Unsent');
  });
});
