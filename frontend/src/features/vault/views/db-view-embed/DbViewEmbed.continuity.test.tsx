import { resetBrowserTestStorage } from '../../../../../tests/browser-storage';
import { GlobalTooltip } from '../../../../shared/ui/tooltip/GlobalTooltip';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DbViewEmbed } from '../DbViewEmbed';
import { VaultGallery } from '../VaultGallery';
import { VaultEditorContext, type VaultEditorContextValue } from '../../../../shared/editor/VaultEditorContext';
import type { VaultViewBodyProps } from '../VaultViewBody';
import { defineStorageKey, removeStorage, stringStorageCodec } from '../../../../shared/platform/browser-storage';
import * as api from './api';
import { pinnedKey, selectedKey } from './preferences';
import type { EmbedBlock, EmbedView, NavApi } from './types';

const fixture = vi.hoisted(() => {
    const state: { body?: VaultViewBodyProps; renderGallery?: boolean; } = {};
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
        if (fixture.renderGallery) return <VaultGallery
            activeView={props.activeView} notes={props.notes} schema={props.schema}
            viewStateScope={props.viewStateScope} searchTerm="" />;
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
let context: VaultEditorContextValue;

beforeEach(() => {
    vi.resetAllMocks(); fixture.body = undefined; fixture.renderGallery = false;
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
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
    await act(async () => { await Promise.resolve(); root.unmount(); });
    container.remove(); vi.unstubAllGlobals();
    for (const key of [pinnedKey('page', 'anchor'), selectedKey('page', 'anchor'), 'gnosi.view.quickPresets.desktop.page.anchor', 'gnosi.view.lastLoad.page.anchor']) removeStorage(defineStorageKey(key, stringStorageCodec));
});
async function render(value: EmbedBlock = block, tooltip = false): Promise<void> {
    await act(async () => { await Promise.resolve(); root.render(<VaultEditorContext.Provider value={context}><DbViewEmbed block={value} />{tooltip && <GlobalTooltip />}</VaultEditorContext.Provider>); });
    await act(async () => { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 5)); });
}
async function click(element: Element | null | undefined): Promise<void> {
    if (!element) throw new Error('Missing clickable element');
    await act(async () => { await Promise.resolve(); element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}
it('keeps view state scoped to the saved anchor across regenerated editor blocks', async () => {
    await render();
    const savedScope = fixture.body?.viewStateScope;
    expect(savedScope).toBe(JSON.stringify(['embed', 'page', 'anchor']));
    await act(async () => { await Promise.resolve(); root.unmount(); });
    root = createRoot(container);
    await render({ ...block, id: 'regenerated-block' });
    expect(fixture.body?.viewStateScope).toBe(savedScope);
    context = { ...context, pageId: 'another-page' };
    await render({ ...block, id: 'another-block' });
    expect(fixture.body?.viewStateScope).toBe(JSON.stringify(['embed', 'another-page', 'anchor']));
});
it('restores the real gallery groups when returning from a PDF rebuilds the resource editor', async () => {
    fixture.renderGallery = true;
    const gallery: EmbedView = { ...anchor, type: 'gallery', groupBy: 'Status', galleryPreview: 'none' };
    vi.mocked(api.fetchVaultViews).mockResolvedValue([gallery]);
    context = { ...context, registry: { ...context.registry, views: [gallery] } };
    vi.mocked(api.fetchVaultPagesByTable).mockResolvedValue([
        { id: 'reading', title: 'Reading note', metadata: { table_id: 'books', Status: 'Reading notes' } },
        { id: 'index', title: 'Index note', metadata: { table_id: 'books', Status: 'Index notes' } },
    ]);
    await render({ ...block, id: 'first-editor-block' });
    const group = () => [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')]
        .find(element => element.textContent.includes('Reading notes'));
    expect(group()?.getAttribute('aria-expanded')).toBe('false');
    await click(group());
    expect(group()?.getAttribute('aria-expanded')).toBe('true');
    await act(async () => { await Promise.resolve(); root.render(<div>PDF tab</div>); });
    await render({ ...block, id: 'second-editor-block' });
    expect(group()?.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Reading note');
    await click(group());
    await act(async () => { await Promise.resolve(); root.render(<div>PDF tab</div>); });
    await render({ ...block, id: 'third-editor-block' });
    expect(group()?.getAttribute('aria-expanded')).toBe('false');
});
