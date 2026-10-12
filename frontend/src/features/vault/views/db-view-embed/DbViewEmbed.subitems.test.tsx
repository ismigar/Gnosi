import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetBrowserTestStorage } from '../../../../../tests/browser-storage';
import { DbViewEmbed } from '../DbViewEmbed';
import { VaultEditorContext, type VaultEditorContextValue } from '../../../../shared/editor/VaultEditorContext';
import type { VaultViewBodyProps } from '../VaultViewBody';
import type { EmbedView } from './types';
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

const anchor: EmbedView = { id: 'anchor', name: 'Project tasks', table_id: 'books', type: 'table', visibleProperties: ['title'] };
const other: EmbedView = { id: 'other', name: 'Other', table_id: 'books', type: 'feed', visibleProperties: ['title'] };
const section: EmbedView = { view_id: 'anchor', heading: 'Tasks', source_table_id: 'books', view_type: 'table', visible_properties: ['title'] };
let context: VaultEditorContextValue;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.clearAllMocks(); fixture.body = undefined;
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    resetBrowserTestStorage('session');
    vi.mocked(api.fetchPageViews).mockResolvedValue({ page_id: 'page', sections: [section] });
    vi.mocked(api.fetchVaultViews).mockResolvedValue([anchor, other]);
    vi.mocked(api.fetchVaultPagesByTable).mockResolvedValue([{ id: 'parent', title: 'Parent', metadata: { table_id: 'books' } }]);
    context = { pageId: 'page', registry: { databases: [], tables: [{ id: 'books', properties: [{ name: 'title', type: 'title' }] }], views: [anchor, other] }, allTables: [], idToTitle: {}, onCreateRecord: null, onDeletePage: null, onEditSchema: null, onOpenParallel: null, onOpenPage: null, onOpenPageViewModal: null, registerEmbedNav: null, exitEmbedToEditor: null, viewSectionNonce: 0 };
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); });
async function render(): Promise<void> {
    await act(async () => {
        root.render(<VaultEditorContext.Provider value={context}><DbViewEmbed block={{ id: 'block', props: { view_id: 'anchor' } }} /></VaultEditorContext.Provider>);
        await Promise.resolve();
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
}

it.each(['table', 'list', 'board', 'gallery', 'timeline', 'feed', 'calendar', 'chart'])(
    'inherits enabled subitems from the table main view in an embedded %s view', async type => {
        const main = { id: 'main', table_id: 'books', name: 'Books', type: 'table', is_main: true, enableSubitems: true };
        context = { ...context, registry: { ...context.registry, views: [{ ...anchor, type }, other, main] } };
        await render();
        expect(fixture.body?.activeView?.enableSubitems).toBe(true);
        expect(fixture.body?.onCreateRecord).toBeTypeOf('function');
        expect(api.updateVaultView).not.toHaveBeenCalled();
    });

it('keeps an explicit embedded opt-out when table subitems are enabled', async () => {
    const main = { id: 'main', table_id: 'books', name: 'Books', type: 'table', is_main: true, enableSubitems: true };
    context = { ...context, registry: { ...context.registry, views: [{ ...anchor, enableSubitems: false }, main] } };
    await render();
    expect(fixture.body?.activeView?.enableSubitems).toBe(false);
});

it('updates inherited subitems when table settings refresh without changing the embedded block', async () => {
    const main = { id: 'main', table_id: 'books', name: 'Books', type: 'table', is_main: true, enableSubitems: false };
    context = { ...context, registry: { ...context.registry, views: [anchor, main] } };
    await render();
    expect(fixture.body?.activeView?.enableSubitems).toBe(false);
    context = { ...context, registry: { ...context.registry, views: [anchor, { ...main, enableSubitems: true }] } };
    await render();
    expect(fixture.body?.activeView?.enableSubitems).toBe(true);
});
