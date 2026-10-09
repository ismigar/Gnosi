import { resetBrowserTestStorage } from '../../../../../tests/browser-storage';
import { GlobalTooltip } from '../../../../shared/ui/tooltip/GlobalTooltip';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DbViewEmbed } from '../DbViewEmbed';
import { VaultEditorContext, type VaultEditorContextValue } from '../../../../shared/editor/VaultEditorContext';
import type { VaultViewBodyProps } from '../VaultViewBody';
import { defineStorageKey, removeStorage, stringStorageCodec } from '../../../../shared/platform/browser-storage';
import * as api from './api';
import { pinnedKey, selectedKey, writeText } from './preferences';
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
async function render(value: EmbedBlock = block, tooltip = false): Promise<void> {
    await act(async () => { await Promise.resolve(); root.render(<VaultEditorContext.Provider value={context}><DbViewEmbed block={value} />{tooltip && <GlobalTooltip />}</VaultEditorContext.Provider>); });
    await act(async () => { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 5)); });
}
async function click(element: Element | null | undefined): Promise<void> {
    if (!element) throw new Error('Missing clickable element');
    await act(async () => { await Promise.resolve(); element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}
function button(label: string): HTMLButtonElement | undefined {
    return [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent.trim() === label || element.getAttribute('aria-label') === label);
}

describe('embedded display titles and exposed filters', () => {
    it.each(['table', 'list', 'board', 'gallery', 'calendar', 'timeline', 'feed', 'chart', 'graph', 'genogram'])('shows the short title for %s without changing the catalog name', async type => {
        const view = { ...anchor, name: 'Tasks per project - Kanban', displayTitle: 'Kanban', type, tabs: [] };
        context = { ...context, registry: { ...context.registry, views: [view] } };
        await render();
        expect(container.querySelector('h2')?.textContent).toBe('Kanban');
        expect(view.name).toBe('Tasks per project - Kanban');
    });
    it('changes results and resets defaults without writing to the shared view', async () => {
        const filterTree = { conjunction: 'and', rules: [{ field: 'title', operator: 'contains', value: 'Alpha', exposed: true }] };
        const view = { ...anchor, tabs: [], filterTree };
        context = { ...context, registry: { ...context.registry, views: [view] } };
        await render();
        expect(fixture.body?.notes?.map(row => row.id)).toEqual(['a']);
        const input = container.querySelector<HTMLInputElement>('fieldset input');
        if (!input) throw new Error('Missing exposed value');
        await act(async () => {
            await Promise.resolve();
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Beta');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(fixture.body?.notes?.map(row => row.id)).toEqual(['b']);
        expect(filterTree.rules[0]?.value).toBe('Alpha');
        expect(api.updateVaultView).not.toHaveBeenCalled();
        await click(button('view.reset_exposed_filters'));
        expect(fixture.body?.notes?.map(row => row.id)).toEqual(['a']);
        await click(container.querySelector('[role="switch"]'));
        expect(fixture.body?.notes?.map(row => row.id)).toEqual(['a', 'b']);
    });
    it('preserves inline section titles and nested exposed filters without a registry entry', async () => {
        context = { ...context, registry: { ...context.registry, views: [] } };
        vi.mocked(api.fetchPageViews).mockResolvedValue({ page_id: 'page', sections: [{ ...section, displayTitle: 'Local', filterTree: {
            conjunction: 'or', rules: [{ field: 'title', operator: 'equals', value: 'Beta', exposed: true }],
        } }] });
        await render();
        expect(container.querySelector('h2')?.textContent).toBe('Local');
        expect(fixture.body?.notes?.map(row => row.id)).toEqual(['b']);
        expect(container.querySelector('[role="switch"]')).not.toBeNull();
    });
});

it('renders saved tab order before the anchor and retains it after a reload', async () => {
    writeText(pinnedKey('page', 'anchor'), JSON.stringify(['other', 'anchor']));
    await render();
    const tabNames = () => [...container.querySelectorAll('button[aria-label="View options"]')]
        .map(button => button.parentElement?.querySelector('span')?.textContent);
    expect(tabNames()).toEqual(['Other', 'Main']);
    context = { ...context, viewSectionNonce: 1 };
    await render();
    expect(tabNames()).toEqual(['Other', 'Main']);
});

it('keeps explicitly unpinned registry tabs hidden on reload', async () => {
    writeText(pinnedKey('page', 'anchor'), JSON.stringify(['anchor']));
    await render();
    expect(container.querySelectorAll('button[aria-label="View options"]')).toHaveLength(0);
});

