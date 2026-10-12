import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetBrowserTestStorage } from '../../../../../tests/browser-storage';
import { DbViewEmbed } from '../DbViewEmbed';
import { VaultEditorContext, type VaultEditorContextValue } from '../../../../shared/editor/VaultEditorContext';
import type { VaultViewBodyProps } from '../VaultViewBody';
import type { EmbedBlock, EmbedRow, EmbedView } from './types';
import * as api from './api';

const fixture = vi.hoisted(() => ({ body: undefined as VaultViewBodyProps | undefined }));
vi.mock('./api', () => ({
    fetchPageViews: vi.fn(), fetchVaultViews: vi.fn(), fetchVaultPagesByTable: vi.fn(), fetchVaultPage: vi.fn(),
    createPageInTable: vi.fn(), updateVaultView: vi.fn(), createVaultView: vi.fn(), fetchVaultViewUsage: vi.fn(), deleteVaultView: vi.fn(),
    deleteVaultPage: vi.fn(), applyVaultTemplate: vi.fn(), patchPageMetadata: vi.fn(), patchSectionConfig: vi.fn(),
    apiErrorDetail: (_error: unknown, fallback: string) => fallback,
    apiErrorStatus: () => undefined,
}));
vi.mock('./diagnostics', () => ({ reportEmbedError: vi.fn() }));
vi.mock('../../../../shared/ui/previews/IconRenderer', () => ({ IconRenderer: () => null }));
vi.mock('../VaultViewBody', () => ({ VaultViewBody: (props: VaultViewBodyProps) => { fixture.body = props; return <div />; } }));
vi.mock('../../../../shared/i18n/useLocaleSettings', () => ({
    useLocaleSettings: () => ({ currencyCode: 'EUR', dateFormat: 'locale', dateLocale: 'en-US', decimalSymbol: '.', numberLocale: 'en-US' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key }) }));

const currentPageRule = { field: 'Contenidor', operator: 'equals', value: 'this' };
const anchor: EmbedView = { id: 'anchor', name: 'Records', table_id: 'records', type: 'table', visibleProperties: ['title'], filters: [currentPageRule], tabs: ['other'] };
const other: EmbedView = { id: 'other', name: 'Other', table_id: 'records', type: 'list', filters: [{ ...currentPageRule, field: 'Referència' }] };
const section: EmbedView = { view_id: 'anchor', heading: 'Records', source_table_id: 'records', view_type: 'table', filters: [currentPageRule] };
const template: EmbedRow = { id: 'template', title: 'Template', metadata: { is_template: true, Contenidor: 'old-page', tags: ['keep'] } };
const block: EmbedBlock = { id: 'block', props: { view_id: 'anchor' } };
let context: VaultEditorContextValue;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.resetAllMocks(); fixture.body = undefined;
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    resetBrowserTestStorage('local'); resetBrowserTestStorage('session');
    vi.mocked(api.fetchPageViews).mockResolvedValue({ page_id: 'page', sections: [section] });
    vi.mocked(api.fetchVaultViews).mockResolvedValue([anchor, other]);
    vi.mocked(api.fetchVaultPagesByTable).mockResolvedValue([template]);
    vi.mocked(api.fetchVaultPage).mockResolvedValue({ ...template, title: 'Template content', content: '# Content', metadata: { ...template.metadata, extra: true } });
    vi.mocked(api.createPageInTable).mockImplementation(input => {
        const created = { id: 'created', title: input.title || 'Created', content: input.content || '',
            metadata: { table_id: input.tableId, ...input.extraMetadata } };
        vi.mocked(api.fetchVaultPagesByTable).mockResolvedValue([template, created]);
        return Promise.resolve({ ...created, folder: '', status: 'ok', message: '' });
    });
    context = { pageId: 'page', registry: { databases: [], tables: [{ id: 'records', properties: [{ name: 'title', type: 'title' }, { name: 'Contenidor', type: 'relation' }] }], views: [anchor, other] },
        allTables: [], idToTitle: {}, onCreateRecord: null, onDeletePage: null, onEditSchema: null, onOpenParallel: null,
        onOpenPage: vi.fn(), onOpenPageViewModal: null, registerEmbedNav: null, exitEmbedToEditor: null, viewSectionNonce: 0 };
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); });
async function render(value: EmbedBlock = block): Promise<void> {
    await act(async () => {
        root.render(<VaultEditorContext.Provider value={context}><DbViewEmbed block={value} /></VaultEditorContext.Provider>);
        await Promise.resolve();
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
}
async function click(label: string): Promise<void> {
    const button = [...container.querySelectorAll('button')].find(element => element.textContent.trim() === label || element.getAttribute('aria-label') === label);
    if (!button) throw new Error(`Missing button: ${label}`);
    await act(async () => { button.click(); await Promise.resolve(); });
}

it.each(['toolbar', 'renderer'])('keeps a newly created record visible after reloading from the %s', async entryPoint => {
    await render();
    expect(fixture.body?.notes).toEqual([]);
    expect(fixture.body?.creationMetadata).toEqual({ Contenidor: 'page' });
    if (entryPoint === 'toolbar') await click('New');
    else await act(async () => { fixture.body?.onCreateRecord?.(); await Promise.resolve(); });
    expect(api.createPageInTable).toHaveBeenCalledWith(expect.objectContaining({ tableId: 'records', extraMetadata: { Contenidor: 'page', is_template: false } }));
    expect(fixture.body?.notes?.map(record => record.id)).toEqual(['created']);
    expect(context.onOpenPage).toHaveBeenCalledWith('created');
});

it('replaces a template relation with the containing page while preserving content and other properties', async () => {
    await render(); await click('New record options'); await click('Template');
    expect(api.createPageInTable).toHaveBeenCalledWith({ tableId: 'records', title: 'Template content', content: '# Content',
        extraMetadata: { is_template: false, Contenidor: 'page', tags: ['keep'], extra: true } });
    expect(fixture.body?.notes?.map(record => record.id)).toEqual(['created']);
    expect(template.metadata.Contenidor).toBe('old-page');
});

it('follows the active tab and containing page without retaining another view defaults', async () => {
    await render();
    const tab = [...container.querySelectorAll('span')].find(element => element.textContent === 'Other')?.parentElement;
    if (!tab) throw new Error('Missing other view tab');
    await act(async () => { tab.click(); await Promise.resolve(); });
    expect(fixture.body?.creationMetadata).toEqual({ Referència: 'page' });
    context = { ...context, pageId: 'second-page' };
    await render(); await click('New');
    expect(api.createPageInTable).toHaveBeenCalledWith(expect.objectContaining({ extraMetadata: { Referència: 'second-page', is_template: false } }));
    expect(fixture.body?.notes?.map(record => record.id)).toEqual(['created']);
});

it('uses nested inline filters instead of stale legacy filters for any source table', async () => {
    vi.mocked(api.fetchPageViews).mockResolvedValue({ page_id: 'page', sections: [] });
    vi.mocked(api.fetchVaultViews).mockResolvedValue([]);
    context = { ...context, registry: { ...context.registry, views: [] } };
    await render({ props: { section: JSON.stringify({ source_table_id: 'resources', view_type: 'table',
        filters: [{ ...currentPageRule, field: 'Obsolete' }],
        filterTree: { conjunction: 'and', rules: [{ ...currentPageRule, field: 'Article' },
            { rules: [{ ...currentPageRule, field: 'Col·lecció' }] }] } }) } });
    expect(fixture.body?.creationMetadata).toEqual({ Article: 'page', 'Col·lecció': 'page' });
    await click('New');
    expect(api.createPageInTable).toHaveBeenCalledWith(expect.objectContaining({ tableId: 'resources', extraMetadata: { Article: 'page', 'Col·lecció': 'page', is_template: false } }));
    expect(fixture.body?.notes?.map(record => record.id)).toEqual(['created']);
});

it('does not assign a disabled exposed current-page filter', async () => {
    const view = { ...anchor, filterTree: { rules: [{ ...currentPageRule, exposed: true }] } };
    context = { ...context, registry: { ...context.registry, views: [view] } };
    vi.mocked(api.fetchVaultViews).mockResolvedValue([view]);
    await render();
    expect(fixture.body?.creationMetadata).toEqual({ Contenidor: 'page' });
    const toggle = container.querySelector<HTMLElement>('[role="switch"]');
    if (!toggle) throw new Error('Missing exposed filter switch');
    await act(async () => { toggle.click(); await Promise.resolve(); });
    expect(fixture.body?.creationMetadata).toEqual({});
    await click('New');
    expect(api.createPageInTable).toHaveBeenCalledWith(expect.objectContaining({ extraMetadata: { is_template: false } }));
});
