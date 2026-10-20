import { describe, expect, it } from 'vitest';
import { defaultWorkspaceLayout, readWorkspaces, saveWorkspaceTab } from './workspacesModel';

describe('saved workspace schema', () => {
    it('migrates v1 page and table tabs without confusing tab IDs with table IDs', () => {
        const result = readWorkspaces([{ id: 'old', name: 'Legacy', tabs: [{ id: 'page', title: 'Page', isTable: false }, { id: 'table:records', title: 'Records', isTable: true }] }], 'vault');
        expect(result[0]).toMatchObject({ version: 2, vaultId: 'vault', tabs: [{ id: 'page', type: 'page' }, { id: 'table:records', type: 'table', tableId: 'records' }], layout: { activeTabId: 'page', paneSizes: [100] } });
    });
    it('roundtrips all document kinds, active view, origins, reader location and unequal splits', () => {
        const tabs = [
            saveWorkspaceTab({ id: 'p', title: 'Page' }, ''),
            saveWorkspaceTab({ id: 'd', title: 'Drawing', isDrawing: true }, ''),
            ...(['pdf', 'epub', 'snapshot'] as const).map(kind => saveWorkspaceTab({ id: kind, title: kind, isPdf: true, src: `/files/${kind}`, kind, location: { pageNumber: 8, position: { index: 2 } }, origin: { tableId: 'table', tabId: 'p', viewId: 'view' } }, '')),
        ];
        const workspace = { version: 2, id: 'new', name: 'Research', vaultId: 'vault', tabs, layout: { ...defaultWorkspaceLayout(tabs), activeTabId: 'pdf', activeViewId: 'view', splitTabIds: ['p'], splitTableIds: ['table'], paneSizes: [50, 20, 30] } };
        expect(readWorkspaces(JSON.parse(JSON.stringify([workspace])), 'other')).toEqual([workspace]);
    });
    it('isolates malformed entries and rejects future versions or unsafe geometry', () => {
        const valid = { id: 'valid', name: 'Legacy', tabs: [{ id: 'p', title: 'Page', isTable: false }] };
        expect(readWorkspaces([null, valid, { ...valid, version: 3 }, { ...valid, version: 2, layout: { paneSizes: [Infinity] } }], 'vault').map(item => item.id)).toEqual(['valid']);
    });
});
