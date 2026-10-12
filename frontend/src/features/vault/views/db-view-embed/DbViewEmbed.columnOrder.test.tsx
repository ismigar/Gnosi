import { resetBrowserTestStorage } from '../../../../../tests/browser-storage';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DbViewEmbed } from '../DbViewEmbed';
import { VaultEditorContext, type VaultEditorContextValue } from '../../../../shared/editor/VaultEditorContext';
import type { VaultViewBodyProps } from '../VaultViewBody';
import { defineStorageKey, removeStorage, stringStorageCodec } from '../../../../shared/platform/browser-storage';
import * as api from './api';
import { writeText, pinnedKey, selectedKey } from './preferences';
import type { EmbedBlock, EmbedView, NavApi } from './types';

const fixture = vi.hoisted(() => {
    const state: { body?: VaultViewBodyProps; } = {};
    return state;
});
vi.mock('./api', () => ({
    fetchPageViews: vi.fn(), fetchVaultViews: vi.fn(), fetchVaultPagesByTable: vi.fn(), fetchVaultPage: vi.fn(),
    createPageInTable: vi.fn(), updateVaultView: vi.fn(), createVaultView: vi.fn(), fetchVaultViewUsage: vi.fn(), deleteVaultView: vi.fn(),
    deleteVaultPage: vi.fn(), applyVaultTemplate: vi.fn(), patchPageMetadata: vi.fn(), patchSectionConfig: vi.fn(),
    apiErrorDetail: (_error: unknown, fallback: string) => fallback,
    apiErrorStatus: (error: unknown) => typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined,
}));
vi.mock('./diagnostics', () => ({ reportEmbedError: vi.fn() }));
vi.mock('../../../literature/records/ReferenceImportExport', () => ({ ReferenceImportExport: () => <span>Reference IO</span> }));
vi.mock('../../../agent/inbox/BrainTools', () => ({ BrainTools: ({ tableId, onChanged }: { readonly tableId: string; readonly onChanged: () => void }) => <button data-testid="brain-tools" onClick={onChanged}>{tableId}</button> }));
vi.mock('../../../../shared/ui/previews/IconRenderer', () => ({ IconRenderer: () => <span aria-hidden="true">icon</span> }));
vi.mock('../VaultViewBody', () => ({
    VaultViewBody: (props: VaultViewBodyProps) => {
        fixture.body = props;
        return <div data-testid="body" data-type={props.type}>{props.notes?.map(note => <button key={note.id} onClick={() => { props.onNoteSelect?.(note.id); }}>{note.title}</button>)}</div>;
    }
}));
vi.mock('../../../../shared/i18n/useLocaleSettings', () => ({
    useLocaleSettings: () => ({ currencyCode: 'EUR', dateFormat: 'locale', dateLocale: 'en-US', decimalSymbol: '.', numberLocale: 'en-US' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: unknown) => {
    if (key === 'views_header.filtered_records_count' && fallback && typeof fallback === 'object' && 'count' in fallback && 'total' in fallback) {
        return `${String(fallback.count)} of ${String(fallback.total)} records`;
    }
    return typeof fallback === 'string' ? fallback : key;
} }) }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const anchor: EmbedView = { id: 'anchor', name: 'Main', table_id: 'books', type: 'table', visibleProperties: ['title'], tabs: ['other'] };
const other: EmbedView = { id: 'other', name: 'Other', table_id: 'books', type: 'feed', visibleProperties: ['title'], filters: [{ field: 'title', operator: 'contains', value: 'Beta' }], plugin: { keep: true } };
const section: EmbedView = { view_id: 'anchor', heading: 'Library', heading_level: 2, source_table_id: 'books', view_type: 'table', visible_properties: ['title'], plugin: 'preserved' };
const block: EmbedBlock = { id: 'block', props: { view_id: 'anchor' } };
const openPage = vi.fn<(id: string) => void>();
const openConfig = vi.fn<(...args: unknown[]) => unknown>();
const register = vi.fn<(id: string, nav: NavApi | null) => void>();
const exit = vi.fn<(id: string | undefined, direction: string) => void>();
let container: HTMLDivElement;
let root: Root;
let mounted = false;
let context: VaultEditorContextValue;

beforeEach(() => {
    vi.resetAllMocks(); fixture.body = undefined;
    resetBrowserTestStorage('session');
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => { callback(0); }, 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { window.clearTimeout(id); });
    vi.mocked(api.fetchPageViews).mockResolvedValue({ page_id: 'page', sections: [section] });
    vi.mocked(api.fetchVaultViews).mockResolvedValue([anchor, other]);
    vi.mocked(api.fetchVaultPagesByTable).mockResolvedValue([
        { id: 'a', title: 'Alpha', metadata: { table_id: 'books' } },
        { id: 'b', title: 'Beta', metadata: { table_id: 'books' } },
        { id: 'template', title: 'Template', metadata: { is_template: true, tags: ['old'] } },
    ]);
    vi.mocked(api.fetchVaultPage).mockResolvedValue({ id: 'template', title: 'Template full', content: '# Template', metadata: { server: true, tags: ['new'] } });
    vi.mocked(api.createPageInTable).mockResolvedValue({ id: 'created', title: 'Created', content: '', metadata: {}, folder: '', status: 'ok', message: '' });
    vi.mocked(api.updateVaultView).mockResolvedValue({ status: 'ok' });
    vi.mocked(api.deleteVaultView).mockResolvedValue({ status: 'ok' });
    vi.mocked(api.patchSectionConfig).mockImplementation((_page, previous, patch) => Promise.resolve({ ...previous, ...patch }));
    vi.mocked(api.fetchVaultViewUsage).mockResolvedValue({ count: 1, pages: [{ id: 'linked', title: 'Linked page', path: 'linked.md' }], view_id: 'other' });
    context = { pageId: 'page', registry: { databases: [], tables: [{ id: 'books', properties: [{ name: 'title', type: 'title' }] }], views: [anchor, other] }, allTables: [], idToTitle: {}, onCreateRecord: null, onDeletePage: null, onEditSchema: null, onOpenParallel: null, onOpenPage: (id: unknown) => { if (typeof id === 'string') openPage(id); }, onOpenPageViewModal: openConfig, registerEmbedNav: register, exitEmbedToEditor: exit, viewSectionNonce: 0 };
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); mounted = true;
});
afterEach(async () => {
    if (mounted) await act(async () => { await Promise.resolve(); root.unmount(); });
    container.remove(); vi.unstubAllGlobals();
    for (const key of [pinnedKey('page', 'anchor'), selectedKey('page', 'anchor'), 'gnosi.view.quickPresets.desktop.page.anchor', 'gnosi.view.lastLoad.page.anchor']) removeStorage(defineStorageKey(key, stringStorageCodec));
});
async function render(value: EmbedBlock = block): Promise<void> {
    await act(async () => { await Promise.resolve(); root.render(<VaultEditorContext.Provider value={context}><DbViewEmbed block={value} /></VaultEditorContext.Provider>); });
    await act(async () => { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 5)); });
}
describe('embedded table column order persistence', () => {
    it.each(['anchor', 'other'])('keeps reordered registry columns after a record reload in %s', async id => {
        const columns = [{ tableId: 'books', fieldKey: 'title', label: 'Nom' }, { tableId: 'books', fieldKey: 'Status' }, { tableId: 'books', fieldKey: 'Date' }];
        const original = { ...(id === 'anchor' ? anchor : other), type: 'table', visibleProperties: columns };
        let saved = original;
        context = { ...context, registry: { ...context.registry, views: [id === 'anchor' ? original : anchor, ...(id === 'other' ? [original] : [])] } };
        vi.mocked(api.fetchVaultViews).mockImplementation(() => Promise.resolve([id === 'anchor' ? saved : anchor, ...(id === 'other' ? [saved] : [])]));
        vi.mocked(api.updateVaultView).mockImplementation((_id, patch) => { saved = { ...saved, ...patch } as typeof original; return Promise.resolve({ status: 'ok' }); });
        writeText(selectedKey('page', 'anchor'), id);
        await render();
        await act(async () => { await fixture.body?.onUpdateView?.({ visibleProperties: ['title', 'Date', 'Status'] }); });
        expect(api.patchSectionConfig).not.toHaveBeenCalled();
        expect(saved.visibleProperties).toEqual([columns[0], columns[2], columns[1]]);
        expect(fixture.body?.activeView?.visibleProperties).toEqual(['title', 'Date', 'Status']);
        await act(async () => { await Promise.resolve(); fixture.body?.onCellSaved?.(); });
        await render();
        expect(fixture.body?.activeView?.visibleProperties).toEqual(['title', 'Date', 'Status']);
    });
    it('updates the synthetic tab of a legacy section when reordering columns', async () => {
        context = { ...context, registry: { ...context.registry, views: [] } };
        vi.mocked(api.fetchVaultViews).mockResolvedValue([]);
        vi.mocked(api.fetchPageViews).mockResolvedValue({ page_id: 'page', sections: [{ ...section, visible_properties: ['title', 'Status', 'Date'] }] });
        await render();
        await act(async () => { await fixture.body?.onUpdateView?.({ visibleProperties: ['title', 'Date', 'Status'] }); });
        expect(fixture.body?.activeView?.visibleProperties).toEqual(['title', 'Date', 'Status']);
        expect(api.patchSectionConfig).toHaveBeenCalledWith('page', expect.anything(), expect.objectContaining({ visible_properties: ['title', 'Date', 'Status'] }));
    });
});
