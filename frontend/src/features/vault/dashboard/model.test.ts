import { describe, expect, it } from 'vitest';
import { applyDashboardJoins } from './joins';
import { prepareDashboardViewContext } from './view-context';
import { buildTableTabId, getTableIdFromTab, reorderTabs, shiftDay } from './tab-model';
import { readPage, readRegistry, isAbortLikeError, errorStatus, retryAfter, readDocumentKind } from './readers';
import { viewTables } from './consumer-readers';
import { editorMetadata, editorNote, editorTable } from './editor-readers';
import { EDIT_LOCKS } from './storage';
import { readStorage, writeStorage } from '../../../shared/platform/browser-storage';
import { historyMaximum } from './useBrowserHistory';
import type { Page, View } from './types';
const page = (id: string, metadata: Record<string, unknown> = {}): Page => ({ id, title: id, metadata });
const resolve = (row: Page) => typeof row.metadata?.table_id === 'string' ? row.metadata.table_id : null;
const view: View = { id: 'v', name: 'View', type: 'table' };
describe('dashboard joins', () => {
  const left = [page('a', { key: ['x', { id: 'y' }], keep: 'left' }), page('b', { key: 'missing' })];
  const right = [page('x', { table_id: 'r', label: 'X', keep: 'right' }), page('y', { table_id: 'r', label: 'Y' }), page('z', { table_id: 'r', label: 'Z' })];
  it('keeps identity when no joins are configured', () => {
    expect(applyDashboardJoins(left, [], right, resolve)).toBe(left);
  });
  it('fans out array references and never overwrites left metadata', () => {
    const result = applyDashboardJoins(left, [{ tableId: 'r', leftField: 'key', rightField: 'id' }], right, resolve);
    expect(result.map(row => [row.id, row.metadata?.label, row.metadata?.keep])).toEqual([['a', 'X', 'left'], ['a', 'Y', 'left']]);
    expect(result[0]?.metadata?.['_join:r']).toEqual([right[0]?.metadata]);
    expect(left[0]?.metadata).not.toHaveProperty('label');
  });
  it('retains unmatched left rows and the legacy right-field alias', () => {
    const result = applyDashboardJoins(left, [{ tableId: 'r', field: 'key', _indexByField: 'id', type: 'left' }], right, resolve);
    expect(result.map(row => row.id)).toEqual(['a', 'a', 'b']);
    expect(result[2]?.metadata?.['_join:r']).toEqual([]);
  });
  it('retains unmatched right metadata and its join envelope', () => {
    const result = applyDashboardJoins(left, [{ tableId: 'r', leftField: 'key', rightField: 'id', type: 'right' }], right, resolve);
    expect(result.map(row => row.id)).toEqual(['a', 'a', 'z']);
    expect(result[2]?.metadata?.['_join:r']).toEqual([right[2]?.metadata]);
  });
  it('does not invent a missing right field', () => {
    expect(applyDashboardJoins(left, [{ tableId: 'r', leftField: 'key' }], right, resolve)).toEqual(left);
  });
  it('supports title aliases, false/zero keys and repeated matches in order', () => {
    const result = applyDashboardJoins([page('a', { relation: ['legacy', false, 0, 'legacy'] })], [{ tableId: 'r', leftField: 'relation', rightField: 'title' }], [{ ...page('1', { table_id: 'r', Nom: 'legacy' }), title: '' }, { ...page('2', { table_id: 'r' }), title: 'false' }, { ...page('3', { table_id: 'r' }), title: '0' }], resolve);
    expect(result).toHaveLength(4);
  });
});
describe('view and tab contracts', () => {
  it('merges joined schema fields without replacing stable IDs or config', () => {
    const table = { id: 'a', name: 'A', database_id: 'db', properties: [{ id: 'fld_one', name: 'Name', type: 'text' }] };
    const joined = { id: 'b', name: 'B', database_id: 'db', properties: [{ id: 'fld_duplicate', name: 'Name', type: 'number' }, { id: 'fld_status', name: 'Status', type: 'select', config: { options: ['new'] } }] };
    const result = prepareDashboardViewContext({ ...view, visibleProperties: [{ fieldKey: 'Name', tableId: 'a' }, 'Status'], joins: [{ tableId: 'b' }] }, table, [table, joined]);
    expect(result.mergedView.visibleProperties).toEqual(['Name', 'Status']);
    expect(result.mergedSchema.Name_config).toEqual({ id: 'fld_one' });
    expect(result.mergedSchema.Status_config).toEqual({ id: 'fld_status', options: ['new'] });
    expect(table.properties).toHaveLength(1);
  });
  it('preserves the table prefix and legacy bare table tabs', () => {
    expect(buildTableTabId('x')).toBe('table:x');
    expect(getTableIdFromTab({ id: 'table:x', isTable: true })).toBe('x');
    expect(getTableIdFromTab({ id: 'legacy', isTable: true })).toBe('legacy');
    expect(getTableIdFromTab({ id: 'table:x' })).toBeNull();
  });
  it('reorders without dropping PDF origins or loaded editor state', () => {
    const tabs = [{ ...page('one'), content: 'body' }, { ...page('pdf'), isPdf: true, origin: { tableId: 't', tabId: null, viewId: 'v' } }];
    expect(reorderTabs(tabs, [{ id: 'pdf' }, { id: 'one' }])).toEqual([tabs[1], tabs[0]]);
  });
  it('shifts daily notes in local calendar time across month/year boundaries', () => {
    expect(shiftDay('2024-03-01', -1)).toBe('2024-02-29');
    expect(shiftDay('2025-12-31', 1)).toBe('2026-01-01');
    expect(shiftDay('invalid', 1)).toBeNull();
  });
  it('drops forward history after a push but preserves it while going back', () => {
    expect(historyMaximum(4, 2, 'POP')).toBe(4);
    expect(historyMaximum(4, 3, 'PUSH')).toBe(3);
  });
});
describe('typed read boundaries', () => {
  it('keeps editor metadata and opaque plugin fields intact while narrowing named fields', () => {
    const nested = { relations: [{ id: 'one' }] };
    expect(editorMetadata({ title: 'Title', extension: nested })).toEqual({ title: 'Title', extension: nested });
    expect(editorMetadata({ table_id: null, title: 42, extension: nested })).toEqual({ extension: nested });
    expect(editorNote({ id: 'page', title: 'Page', resolved_table_id: null }).resolved_table_id).toBeUndefined();
  });
  it('preserves editor field IDs, options, rollups and formatting through actual validation', () => {
    const config = { id: 'fld_status', options: [{ name: 'Done', color: 'blue', extension: 42 }] };
    const rollup = { name: 'Rollup', id: 'fld_rollup', type: 'rollup', targetProperty: 'fld_target', aggregation: 'sum', format: { decimals: 2 }, config };
    const table = editorTable({ id: 'table', name: 'Table', database_id: 'db', properties: [rollup] });
    expect(table.properties).toEqual([rollup]);
    expect(table.properties?.[0]?.config).toBe(config);
  });
  it('retains valid field objects and IDs when preparing the view dialog catalog', () => {
    const field = { name: 'Relation', id: 'fld_relation', relation_database_id: 'linked', options: ['a'] };
    const tables = viewTables([{ id: 'table', name: 'Table', database_id: 'db', properties: [field] }]);
    expect(tables[0]?.properties?.[0]).toBe(field);
  });
  it('defaults old document events to PDF while preserving EPUB and snapshots', () => {
    expect(readDocumentKind(undefined)).toBe('pdf');
    expect(readDocumentKind('epub')).toBe('epub');
    expect(readDocumentKind('snapshot')).toBe('snapshot');
  });
  it('retains unknown metadata, etags and plugin registry fields', () => {
    const input = { id: 'p', title: 'P', etag: 'etag', metadata: { extension: ['x'] } };
    expect(readPage(input)).toEqual(input);
    expect(readRegistry({ tables: [{ id: 't', name: 'T', database_id: 'db', functionalities: [{ id: 'plugin' }] }] }).tables[0]?.functionalities).toEqual([{ id: 'plugin' }]);
    expect(() => readPage({ title: 'missing ID' })).toThrow(TypeError);
  });
  it('recognizes cancellation and Retry-After without untyped error access', () => {
    expect(isAbortLikeError({ code: 'ERR_CANCELED' })).toBe(true);
    expect(isAbortLikeError(new Error('request was aborted'))).toBe(true);
    expect(isAbortLikeError(new Error('network error'))).toBe(false);
    expect(errorStatus({ response: { status: 503 } })).toBe(503);
    expect(retryAfter({ response: { headers: new Headers({ 'retry-after': '3' }) } })).toBe(3);
  });
  it('retains the existing lock key and legacy truthy values', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(writeStorage(EDIT_LOCKS, { page: 'true' }, storage)).toBe(true);
    expect(values.has('gnosi.vault.editLockedPages')).toBe(true);
    expect(readStorage(EDIT_LOCKS, storage)).toEqual({ page: 'true' });
  });
});
