import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vault from '../../shared/api/vaults';
import * as views from '../../shared/api/vault-views';
import { CATALOG, DETAIL, PAGE, PAGE_ID, OTHER_ID, installApiDefaults, renderActions } from './test-support';
vi.mock('../../shared/api/vaults');
vi.mock('../../shared/api/vault-views');
vi.mock('../../shared/api/daily-notes');
vi.mock('../../shared/api/drawings');
let harness: Awaited<ReturnType<typeof renderActions>>;
beforeEach(async () => {
  vi.clearAllMocks();
  installApiDefaults();
  harness = await renderActions();
  await harness.run(state => { state.setRegistry(CATALOG); state.setPages([PAGE]); });
});
afterEach(async () => { await harness.unmount(); });
describe('editor and page mutations', () => {
    it('tracks only confirmed bulk deletions and treats 404 as already deleted', async () => {
        vi.mocked(vault.deleteVaultPage).mockRejectedValueOnce({ response: { status: 404 } }).mockRejectedValueOnce({ response: { status: 403 } });
        await harness.run(state => state.handleDeleteSelected(new Set([PAGE_ID, OTHER_ID])));
        expect(harness.current.undoStack).toEqual([{ type: 'delete', ids: [PAGE_ID] }]);
        expect(harness.current.redoStack).toEqual([]);
    });
    it('keeps a completely failed undo available for retry', async () => {
        vi.mocked(vault.restoreVaultPage).mockRejectedValueOnce({ response: { status: 503 } });
        await harness.run(state => { state.setUndoStack([{ type: 'delete', ids: [PAGE_ID] }]); });
        await harness.run(state => state.undoLastOperation());
        expect(harness.current.undoStack).toEqual([{ type: 'delete', ids: [PAGE_ID] }]);
        expect(harness.current.redoStack).toEqual([]);
    });
    it('moves only successful redo IDs back to undo after partial failure', async () => {
        vi.mocked(vault.deleteVaultPage).mockRejectedValueOnce({ response: { status: 404 } }).mockRejectedValueOnce({ response: { status: 403 } });
        await harness.run(state => { state.setRedoStack([{ type: 'delete', ids: [PAGE_ID, OTHER_ID] }]); });
        await harness.run(state => state.redoLastOperation());
        expect(harness.current.undoStack).toEqual([{ type: 'delete', ids: [PAGE_ID] }]);
        expect(harness.current.redoStack).toEqual([]);
    });
    it('rolls back relation undo locally when its metadata patch fails', async () => {
        const operation = { type: 'relation_unlink' as const, pageId: PAGE_ID, field: 'Relation', metadataKey: 'fld_relation', previousValue: ['one', 'two'], nextValue: ['one'] };
        vi.mocked(vault.patchVaultPage).mockRejectedValueOnce(new Error('synthetic relation failure'));
        await harness.run(state => { state.setUndoStack([operation]); state.setTabs([{ ...PAGE, metadata: { fld_relation: ['one'] } }]); });
        await harness.run(state => state.undoLastOperation());
        expect(harness.current.undoStack).toEqual([operation]);
        expect(harness.current.tabs[0]?.metadata?.fld_relation).toEqual(['one']);
        expect(vault.patchVaultPage).toHaveBeenCalledWith(PAGE_ID, { metadata: { fld_relation: ['one', 'two'] } });
    });
  it('keeps body content on metadata-only updates and updates every visible cache', async () => {
    const row = { ...PAGE, content: 'do not lose' };
    await harness.run(state => {
      state.setTabs([row]);
      state.setPages([row]);
      state.setTableNotes([row]);
      state.setVisibleTableRecordsById({ table: [row] });
    });
    await harness.run(state => { state.handleEditorUpdate(PAGE_ID, undefined, { title: 'Renamed', metadata: { favorite: true } }); });
    for (const row of [harness.current.tabs[0], harness.current.pages[0], harness.current.tableNotes[0], harness.current.visibleTableRecordsById.table?.[0]]) {
      expect(row).toMatchObject({ title: 'Renamed', content: 'do not lose', metadata: { favorite: true } });
    }
    expect(harness.current.globalIndex[PAGE_ID]).toBe('Renamed');
    expect(vault.saveVaultPage).not.toHaveBeenCalled();
  });
  it('renames with the exact full-page save payload and leaves etag mediation to the shared API', async () => {
    await harness.run(state => state.handleRenamePage(PAGE_ID, 'New title'));
    expect(vault.saveVaultPage).toHaveBeenCalledWith(PAGE_ID, { title: 'New title', content: 'body', is_database: false, parent_id: null, metadata: { table_id: 'table', title: 'New title' } });
  });
  it('updates favorites optimistically without changing content', async () => {
    await harness.run(state => { state.setTabs([{ ...PAGE, content: 'body' }]); });
    await harness.run(state => state.handleToggleFavorite(PAGE_ID));
    expect(vault.saveVaultPage).toHaveBeenCalledWith(PAGE_ID, { title: 'Page', content: 'body', is_database: false, parent_id: null, metadata: { table_id: 'table', favorite: true } });
    expect(harness.current.pages[0]?.metadata?.favorite).toBe(true);
    expect(harness.current.tabs[0]?.metadata?.favorite).toBe(true);
  });
  it('passes board updates unchanged and rethrows failures for optimistic rollback', async () => {
    const error = new Error('synthetic rejected patch');
    vi.mocked(vault.patchVaultPage).mockRejectedValueOnce(error);
    await expect(harness.current.handleUpdateNote(PAGE_ID, { metadata: { fld_status: 'Done' } })).rejects.toBe(error);
    expect(vault.patchVaultPage).toHaveBeenCalledWith(PAGE_ID, { metadata: { fld_status: 'Done' } });
  });
  it('persists parent moves in both the top-level and metadata fields', async () => {
    await harness.run(state => state.handleMovePage(PAGE_ID, OTHER_ID));
    expect(vault.patchVaultPage).toHaveBeenCalledWith(PAGE_ID, { parent_id: OTHER_ID, metadata: { parent_id: OTHER_ID } });
  });
  it('patches option catalogs using stable field IDs', async () => {
    await harness.run(state => state.handleAddSchemaOption('table', 'fld_status', [{ name: 'New', color: 'blue' }]));
    expect(vault.patchVaultTableProperty).toHaveBeenCalledWith('table', 'fld_status', { config: { options: [{ name: 'New', color: 'blue' }] } });
  });
});
describe('templates and views', () => {
    it('keeps nested metadata intact when applying shared default formulas', async () => {
        const values = ['one', 'two'];
        await harness.run(state => { state.setRegistry({ ...CATALOG, tables: [{ ...CATALOG.tables[0], id: 'table', name: 'Table', database_id: 'db', properties: [{ name: 'Copy', type: 'text', defaultFormula: '{Relation}' }] }] }); });
        const result = harness.current.applySchemaDefaults('table', { Relation: values, extension: { flag: true } });
        expect(result).toEqual({ Relation: values, extension: { flag: true }, Copy: 'one,two' });
        expect(result.Relation).toBe(values);
    });
  it('creates records from explicit templates without persisting their template ID', async () => {
    vi.mocked(vault.fetchVaultPage).mockResolvedValueOnce({ ...DETAIL, title: 'Template', content: 'template body', metadata: { id: 'template', is_template: true, marker: 'keep' } });
    await harness.run(state => state.handleAddNewNote('table', 'template'));
    expect(vault.createVaultPage).toHaveBeenCalledWith({
      title: 'Template', content: 'template body', is_database: false,
      metadata: { id: undefined, is_template: false, marker: 'keep', table_id: 'table', database_table_id: 'table' }
    });
  });
  it('retains the distinct create-record flag reset for default templates', async () => {
    vi.mocked(vault.fetchVaultPage).mockResolvedValueOnce({ ...DETAIL, title: 'Template', metadata: { is_template: true, is_default_template: true } });
    await harness.run(state => state.handleCreateRecordForTable('table', 'template'));
    expect(vault.createVaultPage).toHaveBeenCalledWith(expect.objectContaining({ metadata: { is_template: false, is_default_template: false, id: undefined, table_id: 'table', database_table_id: 'table' } }));
  });
  it('never saves the virtual default view', async () => {
    await harness.run(state => state.handleUpdateView({ id: 'default', name: 'Ignored' }));
    expect(views.updateVaultView).not.toHaveBeenCalled();
  });
  it('retains main-view canonicalization and column descriptor payloads', async () => {
    const custom = { id: 'custom', table_id: 'table', name: 'Custom', type: 'table', visibleProperties: [{ tableId: 'table', fieldKey: 'Status' }] };
    await harness.run(state => { state.setRegistry({ ...CATALOG, views: [...CATALOG.views, custom] }); });
    await harness.run(state => state.handleUpdateView({ id: 'custom', table_id: 'table', visibleProperties: ['Status'] }));
    expect(views.updateVaultView).toHaveBeenCalledWith('custom', { id: 'custom', table_id: 'table', visibleProperties: [{ tableId: 'table', fieldKey: 'Status' }], is_main: false });
  });
  it('creates dashboards with the existing JSON body and metadata', async () => {
    await harness.run(state => { state.handleOpenCreatePrompt(null, false, false, true); });
    await harness.run(state => { state.setPromptModal(previous => ({ ...previous, inputValue: 'Dashboard' })); });
    await harness.run(state => state.executeCreateContent());
    expect(vault.createVaultPage).toHaveBeenCalledWith({ title: 'Dashboard', content: '{\n  \n}', parent_id: null, is_database: false, metadata: { is_dashboard: true, content_format: 'json' } });
  });
});
