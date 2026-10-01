import React, { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createInstance } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TableSchemaDialog } from './TableSchemaDialog';
import { createVaultTable } from '../../../shared/api/vaults';
import type { SchemaConfigModalProps, SaveOptions } from '../schema/schema-config/types';

const captured = vi.hoisted(() => ({ props: null as SchemaConfigModalProps | null }));
vi.mock('../schema/SchemaConfigModal', () => ({ SchemaConfigModal: (props: SchemaConfigModalProps) => { captured.props = props; return null; } }));
vi.mock('../../../shared/api/vaults', () => ({ createVaultTable: vi.fn() }));

type Context = ComponentProps<typeof TableSchemaDialog>['dashboard'];
const viewConfig: SaveOptions = { enableSubitems: false, visibleProperties: ['Title', 'Status'], enableTranslation: false, enableDrupalSync: false, drupalBundle: '', drupalFieldMapping: {}, functionalities: [] };
const schema = (options: string[]) => ({ Title: 'title', Title_config: { id: 'title' }, Status: 'status', Status_config: { id: 'status', options } });
let root: Root;
let container: HTMLDivElement;
let context: Context;
let revision: number;

beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    revision = 7;
    vi.mocked(createVaultTable).mockImplementation(input => {
        if (input.schema_revision !== revision) return Promise.reject(new Error('The table schema changed after this editor loaded it'));
        return Promise.resolve({ ...input, schema_revision: ++revision });
    });
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: {}, initImmediate: false });
    context = {
        activeTableId: 'table', activeViewId: 'view',
        registry: { databases: [], tables: [{ id: 'table', name: 'Table', database_id: 'database', schema_revision: 7 }], views: [] },
        getTableViews: vi.fn(() => [{ id: 'view', table_id: 'table', name: 'Table', type: 'table', enableSubitems: false, visibleProperties: ['Title', 'Status'] }]),
        getSchemaFromTableId: vi.fn(() => schema(['Open', 'Done', 'Review'])),
        setIsSchemaModalOpen: vi.fn(), t: i18n.t, setSchema: vi.fn(), handleUpdateView: vi.fn(), fetchRegistry: vi.fn(),
    };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => { root.render(<TableSchemaDialog dashboard={context} />); await Promise.resolve(); });
});
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); vi.unstubAllGlobals(); });

function saveCallback() {
    const save = captured.props?.onSave;
    if (!save) throw new Error('Missing schema save callback');
    return save;
}

describe('consecutive table schema saves', () => {
    it('uses each acknowledged revision even when queued saves retain the original callback', async () => {
        const save = saveCallback();
        await save(schema(['Done', 'Review']), viewConfig);
        await save(schema(['Review']), viewConfig);
        await save(schema([]), viewConfig);
        expect(vi.mocked(createVaultTable).mock.calls.map(([input]) => input.schema_revision)).toEqual([7, 8, 9]);
        expect(context.handleUpdateView).not.toHaveBeenCalled();
        expect(context.fetchRegistry).toHaveBeenCalledTimes(3);
    });

    it('propagates a failed write and allows a retry with the last acknowledged revision', async () => {
        vi.mocked(createVaultTable).mockRejectedValueOnce(new Error('Offline'));
        const save = saveCallback();
        await expect(save(schema(['Done']), viewConfig)).rejects.toThrow('Offline');
        expect(context.setSchema).not.toHaveBeenCalled();
        expect(context.fetchRegistry).not.toHaveBeenCalled();
        await save(schema(['Done']), viewConfig);
        expect(vi.mocked(createVaultTable).mock.calls.map(([input]) => input.schema_revision)).toEqual([7, 7]);
    });

    it('keeps rejecting changes from another editor instead of bypassing revision checks', async () => {
        const save = saveCallback();
        await save(schema(['Done']), viewConfig);
        revision = 10;
        await expect(save(schema([]), viewConfig)).rejects.toThrow('table schema changed');
        expect(vi.mocked(createVaultTable).mock.calls.at(-1)?.[0].schema_revision).toBe(8);
        expect(context.setSchema).toHaveBeenCalledTimes(1);
    });

    it('persists view configuration when the visible fields actually change', async () => {
        await saveCallback()(schema(['Done']), { ...viewConfig, visibleProperties: ['Title'] });
        expect(context.handleUpdateView).toHaveBeenCalledWith(expect.objectContaining({ id: 'view', visibleProperties: ['Title'] }));
    });
});
