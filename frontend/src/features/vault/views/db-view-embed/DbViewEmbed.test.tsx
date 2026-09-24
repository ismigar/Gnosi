import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DbViewEmbed } from '../DbViewEmbed';
import { VaultEditorContext, type VaultEditorContextValue } from '../../../../shared/editor/VaultEditorContext';
import type { VaultViewBodyProps } from '../VaultViewBody';
import { defineStorageKey, removeStorage, stringStorageCodec } from '../../../../shared/platform/browser-storage';
import { emitAppEvent } from './events';
import { subscribeAppEvent } from '../../../../shared/platform/app-events';
import { dispatchWindowEvent } from '../../../../shared/platform/browser-events';
import * as api from './api';
import { readText, writeText, pinnedKey, selectedKey } from './preferences';
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
it('forwards parallel opening from an embedded view to its editor', async () => {
    const parallel = vi.fn();
    context = { ...context, onOpenParallel: parallel };
    await render();
    expect(fixture.body?.onOpenParallel).toBeDefined();
    fixture.body?.onOpenParallel?.('b');
    expect(parallel).toHaveBeenCalledExactlyOnceWith('b');
    expect(openPage).not.toHaveBeenCalled();
});
async function click(element: Element | null | undefined): Promise<void> {
    if (!element) throw new Error('Missing clickable element');
    await act(async () => { await Promise.resolve(); element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}
function button(label: string): HTMLButtonElement | undefined {
    return [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent.trim() === label || element.getAttribute('aria-label') === label);
}
async function inputValue(input: HTMLInputElement | null, value: string): Promise<void> {
    if (!input) throw new Error('Missing input');
    await act(async () => {
        await Promise.resolve();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
async function tabMenu(): Promise<void> { await click(container.querySelectorAll('button[aria-label="View options"]')[1]); }

describe('embedded view data and editor navigation', () => {
    it('provides Brain tools on the configured embedded table and refreshes its records', async () => {
        context = { ...context, brainTableId: 'books' };
        await render();
        const tools = container.querySelector('[data-testid="brain-tools"]');
        expect(tools?.textContent).toBe('books');
        await click(tools);
        expect(api.fetchVaultPagesByTable).toHaveBeenCalledTimes(2);
    });
    it('keeps Brain tools out of other embedded tables', async () => {
        context = { ...context, brainTableId: 'another-table' };
        await render();
        expect(container.querySelector('[data-testid="brain-tools"]')).toBeNull();
    });
    it('loads fresh records, keeps templates out and restores the selected tab', async () => {
        writeText(selectedKey('page', 'anchor'), 'other');
        await render();
        expect(container.textContent).toContain('Library');
        expect(fixture.body?.type).toBe('feed'); expect(fixture.body?.notes?.map(note => note.id)).toEqual(['b']);
        expect(fixture.body?.templates).toHaveLength(1);
        await click(button('Beta')); expect(openPage).toHaveBeenCalledWith('b');
        context = { ...context, viewSectionNonce: 1 }; await render();
        expect(api.fetchVaultPagesByTable).toHaveBeenCalledTimes(2); expect(api.fetchPageViews).toHaveBeenCalledTimes(2);
    });
    it('supports inline config, registry fallback and a recoverable missing-view error', async () => {
        vi.mocked(api.fetchPageViews).mockResolvedValue({ page_id: 'page', sections: [] });
        await render(); expect(fixture.body?.notes).toHaveLength(2);
        await render({ id: 'inline', props: { section: JSON.stringify({ source_table_id: 'books', view_type: 'list', heading: 'Inline' }) } });
        expect(container.textContent).toContain('Inline');
        context = { ...context, registry: { ...context.registry, views: [] } };
        vi.mocked(api.fetchVaultViews).mockResolvedValue([]);
        await render({ id: 'missing', props: { view_id: 'missing' } });
        expect(container.textContent).toContain('not found in the registry');
    });
    it('renders the existing error fallback on a failed request', async () => {
        vi.mocked(api.fetchPageViews).mockRejectedValue(new Error('offline'));
        await render(); expect(container.textContent).toContain('Error loading the view');
        expect(container.querySelector('[data-testid="body"]')).toBeNull();
    });
    it('does not continue loading a table after unmount during the section request', async () => {
        let finish: ((value: Awaited<ReturnType<typeof api.fetchPageViews>>) => void) | undefined;
        vi.mocked(api.fetchPageViews).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        await act(async () => { await Promise.resolve(); root.render(<VaultEditorContext.Provider value={context}><DbViewEmbed block={block} /></VaultEditorContext.Provider>); });
        await act(async () => { await Promise.resolve(); root.unmount(); }); mounted = false;
        await act(async () => { await Promise.resolve(); finish?.({ page_id: 'page', sections: [section] }); });
        expect(api.fetchVaultPagesByTable).not.toHaveBeenCalled();
    });
    it.each(['table', 'list', 'gallery'])('keeps two focus levels and shortcut cleanup for %s', async type => {
        vi.mocked(api.fetchPageViews).mockResolvedValue({ page_id: 'page', sections: [{ ...section, view_type: type }] });
        vi.mocked(api.fetchVaultViews).mockResolvedValue([{ ...anchor, type }, other]);
        context = { ...context, registry: { ...context.registry, views: [{ ...anchor, type }, other] } };
        await render();
        const first = vi.fn<() => boolean>().mockReturnValue(true);
        fixture.body?.registerNavApi?.({ focusFirstCell: first });
        const bridge = register.mock.calls.at(-1)?.[1]; expect(bridge?.focusFirstCell?.()).toBe(true);
        const shell = container.querySelector<HTMLElement>('.gnosi-view-embed-container');
        expect(document.activeElement).toBe(shell);
        expect(first).not.toHaveBeenCalled();
        shell?.focus();
        await act(async () => { await Promise.resolve(); shell?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
        expect(first).toHaveBeenCalledTimes(1);
        button('Alpha')?.focus();
        fixture.body?.onEscape?.();
        expect(document.activeElement).toBe(shell);
        expect(exit).not.toHaveBeenCalled();
        await act(async () => { await Promise.resolve(); shell?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(exit).toHaveBeenCalledWith('block', 'escape');
        await act(async () => { await Promise.resolve(); shell?.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true })); });
        expect(container.querySelector('input[placeholder="Search..."]')).not.toBeNull();
        await act(async () => { await Promise.resolve(); root.unmount(); }); mounted = false;
        expect(register.mock.calls.at(-1)).toEqual(['block', null]);
        await act(async () => { await Promise.resolve(); dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true })); });
        expect(api.createPageInTable).not.toHaveBeenCalled();
    });
});

describe('embedded record and view actions', () => {
    it.each(['table', 'gallery', 'feed'])('expands an empty %s search to the whole table and restores filters on clear', async type => {
        writeText(selectedKey('page', 'anchor'), 'other');
        context = { ...context, registry: { ...context.registry, views: [anchor, { ...other, type }] } };
        await render();
        await click(button('Search'));
        const scope = container.querySelector<HTMLSelectElement>('select[aria-label="Search in"]');
        expect(scope?.value).toBe('view');
        await inputValue(container.querySelector('input[placeholder="Search..."]'), 'Alpha');
        expect(container.querySelector('[data-testid="body"]')).toBeNull();
        expect(container.textContent).toContain('No matches in this view. Its filters still apply.');
        expect(container.querySelector('[role="status"]')?.textContent).toContain('0 of 2 records');
        await click(button('Search the entire table'));
        expect(scope?.value).toBe('table');
        expect(fixture.body?.notes?.map(note => note.id)).toEqual(['a']);
        expect(fixture.body?.activeView?.id).toBe('other');
        expect(container.querySelector('[role="status"]')?.textContent).toContain('1 of 2 records');
        expect(api.updateVaultView).not.toHaveBeenCalled();
        await inputValue(container.querySelector('input[placeholder="Search..."]'), '');
        expect(scope?.value).toBe('view');
        expect(fixture.body?.notes?.map(note => note.id)).toEqual(['b']);
        expect(api.fetchVaultPagesByTable).toHaveBeenCalledTimes(1);
    });
    it('searches the base table even when the view has an inner join', async () => {
        vi.mocked(api.fetchPageViews).mockResolvedValue({ page_id: 'page', sections: [{ ...section,
            joins: [{ tableId: 'joined', leftField: 'key', rightField: 'key' }],
        }] });
        vi.mocked(api.fetchVaultPagesByTable).mockImplementation(id => Promise.resolve(id === 'books'
            ? [{ id: 'a', title: 'Alpha', metadata: { key: 'missing' } }]
            : [{ id: 'linked', title: 'Linked', metadata: { key: 'other' } }]));
        await render();
        await click(button('Search'));
        await inputValue(container.querySelector('input[placeholder="Search..."]'), 'Alpha');
        expect(container.querySelector('[data-testid="body"]')).toBeNull();
        await click(button('Search the entire table'));
        expect(fixture.body?.notes?.map(note => note.id)).toEqual(['a']);
    });
    it.each([
        ['DESDE EL REINO DE LOS SUEÑOS', ['dreams']],
        ['desde%Suenos', ['dreams']],
        ['/reino.*suenos$/i', ['dreams']],
        ['tomas halik', ['dreams']],
        ['x', ['single']],
        ['missing title', []],
    ])('keeps the count and renderer consistent for search %s', async (query, expected) => {
        vi.mocked(api.fetchVaultPagesByTable).mockResolvedValue([
            { id: 'dreams', title: 'DESDE EL REINO DE LOS SUEÑOS', metadata: { Autoría: [{ nom: 'Tomás', cognom1: 'Halík', cognom2: '' }] } },
            { id: 'partial', title: 'Desde otra perspectiva', metadata: {} },
            { id: 'single', title: 'X', metadata: {} },
        ]);
        await render();
        await click(button('Search'));
        await inputValue(container.querySelector('input[placeholder="Search..."]'), query);
        if (expected.length) {
            expect(fixture.body?.notes?.map(note => note.id)).toEqual(expected);
            expect(fixture.body?.searchTerm).toBe(query);
        } else {
            expect(container.querySelector('[data-testid="body"]')).toBeNull();
            expect(button('Search the entire table')).toBeDefined();
        }
        expect(container.querySelector('[role="status"]')?.textContent).toContain(`${String(expected.length)} of 3 records`);
    });
    it('finds a saved title immediately when returning to an embedded view', async () => {
        await render();
        await act(async () => { root.render(null); await Promise.resolve(); });
        vi.mocked(api.fetchVaultPagesByTable).mockResolvedValue([
            { id: 'a', title: 'A newly saved title', metadata: { table_id: 'books' } },
        ]);
        await render();
        await click(button('Search'));
        await inputValue(container.querySelector('input[placeholder="Search..."]'), 'newly saved title');
        expect(fixture.body?.notes?.map(note => note.id)).toEqual(['a']);
        expect(api.fetchVaultPagesByTable).toHaveBeenCalledTimes(2);
    });
    it('refreshes a visible embed after a record is saved without clearing its search', async () => {
        await render();
        await click(button('Search'));
        await inputValue(container.querySelector('input[placeholder="Search..."]'), 'new title');
        const searchInput = container.querySelector<HTMLInputElement>('input[placeholder="Search..."]');
        expect(document.activeElement).toBe(searchInput);
        expect(container.querySelector('[data-testid="body"]')).toBeNull();
        vi.mocked(api.fetchVaultPagesByTable).mockResolvedValue([
            { id: 'a', title: 'New title', metadata: { table_id: 'books' } },
        ]);
        await act(async () => { emitAppEvent('gnosi:invalidatePreview', { pageId: 'a' }); await Promise.resolve(); });
        expect(fixture.body?.notes?.map(note => note.id)).toEqual(['a']);
        expect(container.querySelector<HTMLInputElement>('input[placeholder="Search..."]')?.value).toBe('new title');
        expect(document.activeElement).toBe(searchInput);
        expect(api.fetchVaultPagesByTable).toHaveBeenCalledTimes(2);
        await act(async () => { emitAppEvent('gnosi:invalidatePreview', { pageId: 'page' }); await Promise.resolve(); });
        expect(api.fetchVaultPagesByTable).toHaveBeenCalledTimes(2);
    });
    it('keeps source/template creation callbacks and pins a newly configured view', async () => {
        const createTemplate = vi.fn<(id: string) => void>();
        const createFromSource = vi.fn<(id: string) => void>();
        const configure = vi.fn<(...args: unknown[]) => void>((_input, save) => {
            if (typeof save === 'function') Reflect.apply(save, undefined, [{ id: 'new-tab' }]);
        });
        context = { ...context, referenceTableId: 'books', onCreateTemplate: createTemplate, onCreateFromSource: createFromSource, onOpenViewConfig: configure };
        await render(); await click(button('New record options')); await click(button('New template'));
        expect(createTemplate).toHaveBeenCalledWith('books');
        await click(button('New record options')); await click(button('views_header.new_from_source'));
        expect(createFromSource).toHaveBeenCalledWith('books');
        await click(button('Add view'));
        expect(configure).toHaveBeenCalledWith({ type: 'table', name: '' }, expect.any(Function));
        expect(api.updateVaultView).toHaveBeenCalledWith('anchor', { tabs: ['other', 'new-tab'] });
    });
    it('duplicates all view options but removes main/default identity before pinning', async () => {
        vi.mocked(api.createVaultView).mockResolvedValue({ id: 'copy' });
        const original = { ...other, is_main: true, is_default: true, chartType: 'bar', xField: 'score', sorts: [{ field: 'title' }] };
        context = { ...context, registry: { ...context.registry, views: [anchor, original] } };
        await render(); await tabMenu(); await click(button('Duplicate'));
        expect(api.createVaultView).toHaveBeenCalledWith(expect.objectContaining({ name: 'Other (còpia)', chartType: 'bar', xField: 'score', plugin: { keep: true }, embedded: true }));
        const payload = vi.mocked(api.createVaultView).mock.calls[0]?.[0];
        expect(payload).not.toHaveProperty('id'); expect(payload).not.toHaveProperty('is_main'); expect(payload).not.toHaveProperty('is_default');
        expect(api.updateVaultView).toHaveBeenCalledWith('anchor', { tabs: ['other', 'copy'] });
    });
    it('searches locally and saves a portable quick preset to the anchor', async () => {
        await render(); await click(button('Search')); await inputValue(container.querySelector('input[placeholder="Search..."]'), 'beta');
        expect(fixture.body?.notes?.map(note => note.id)).toEqual(['b']);
        expect(api.fetchVaultPagesByTable).toHaveBeenCalledTimes(1);
        await click(button('views_header.save_quick_view'));
        expect(api.updateVaultView).toHaveBeenCalledWith('anchor', expect.objectContaining({ quickPresets: [expect.objectContaining({ searchTerm: 'beta', activeViewId: 'anchor', density: 'comfortable', groupMode: 'none' })] }));
        expect(readText('gnosi.view.quickPresets.desktop.page.anchor')).toContain('beta');
    });
    it('creates from full template content with local metadata precedence and opens the result', async () => {
        await render(); await click(button('New record options')); await click(button('iconTemplate'));
        expect(api.createPageInTable).toHaveBeenCalledWith({ tableId: 'books', title: 'Template full', content: '# Template', extraMetadata: { server: true, tags: ['old'], is_template: false } });
        expect(openPage).toHaveBeenCalledWith('created');
        expect(api.fetchVaultPagesByTable).toHaveBeenCalledTimes(2);
    });
    it('persists composite column resizing to the section without losing plugin config', async () => {
        vi.mocked(api.fetchPageViews).mockResolvedValue({ page_id: 'page', sections: [{ ...section, visible_properties: [{ tableId: 'books', fieldKey: 'title', label: 'Nom' }] }] });
        context = { ...context, registry: { ...context.registry, views: [] } };
        await render();
        await act(async () => { await Promise.resolve(); await fixture.body?.onUpdateView?.({ visibleProperties: ['title'], columnWidths: { title: 240 }, sort: [{ field: 'title', direction: 'desc' }] }); });
        expect(api.patchSectionConfig).toHaveBeenCalledWith('page', expect.objectContaining({ plugin: 'preserved' }), expect.objectContaining({ visible_properties: [{ tableId: 'books', fieldKey: 'title', label: 'Nom' }], columnWidths: { title: 240 }, sorts: [{ field: 'title', direction: 'desc' }] }));
        expect(api.updateVaultView).not.toHaveBeenCalled();
    });
    it('updates a selected registry tab and preserves its plugin options', async () => {
        writeText(selectedKey('page', 'anchor'), 'other'); await render();
        await act(async () => { await Promise.resolve(); await fixture.body?.onUpdateView?.({ visibleProperties: ['title'], group_by: 'status', columnWidths: { title: 180 } }); });
        expect(api.updateVaultView).toHaveBeenCalledWith('other', expect.objectContaining({ plugin: { keep: true }, group_by: 'status', columnWidths: { title: 180 } }));
        expect(api.patchSectionConfig).not.toHaveBeenCalled();
        await act(async () => { await fixture.body?.onUpdateView?.({ group_by: null }); });
        expect(api.updateVaultView).toHaveBeenLastCalledWith('other', expect.objectContaining({ group_by: null }));
    });
    it('unpins without deletion and persists only the anchor tabs', async () => {
        await render(); await tabMenu(); await click(button('Remove from this page'));
        expect(api.deleteVaultView).not.toHaveBeenCalled();
        expect(api.updateVaultView).toHaveBeenCalledWith('anchor', { tabs: [] });
        expect(readText(pinnedKey('page', 'anchor'))).toBe('[]');
        expect(container.querySelectorAll('button[aria-label="View options"]')).toHaveLength(0);
    });
    it('shows linked usage and requires explicit confirmation for global deletion', async () => {
        await render(); await tabMenu(); await click(button('Delete everywhere…'));
        expect(document.body.textContent).toContain('Linked page'); expect(api.deleteVaultView).not.toHaveBeenCalled();
        await click(button('Delete')); expect(api.deleteVaultView).toHaveBeenCalledWith('other');
    });
    it('renames the full registry view and opens config with a synthetic block', async () => {
        await render(); await tabMenu(); await click(button('Configure'));
        expect(openConfig).toHaveBeenCalledWith('books', { id: 'block', props: { view_id: 'other', heading: '', heading_level: 1 } });
        await tabMenu(); await click(button('Rename'));
        await act(async () => { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 5)); });
        await inputValue(document.querySelector('input[type="text"]'), 'Renamed'); await click(button('Rename'));
        expect(api.updateVaultView).toHaveBeenCalledWith('other', expect.objectContaining({ name: 'Renamed', plugin: { keep: true } }));
    });
    it('reports successful and already-deleted ids for global undo, excluding failures', async () => {
        await render();
        const received: (readonly string[])[] = [];
        const cleanup = subscribeAppEvent('gnosi:records-deleted', detail => { received.push(detail.ids); });
        vi.mocked(api.deleteVaultPage).mockImplementation(id => id === 'a' ? Promise.resolve({ id, status: 'ok', retention_days: 30 }) : Promise.reject(Object.assign(new Error('delete failed'), { status: id === 'missing' ? 404 : 403 })));
        await act(async () => { await Promise.resolve(); fixture.body?.onDeleteSelected?.(new Set(['a', 'missing', 'denied'])); });
        expect(received).toEqual([['a', 'missing']]); cleanup();
    });
    it('opens tools through the shared event and renders the inline graph without the table renderer', async () => {
        context = { ...context, registry: { ...context.registry, views: [] } };
        vi.mocked(api.fetchPageViews).mockResolvedValue({ page_id: 'page', sections: [{ ...section, view_type: 'graph' }] });
        await render(); expect(container.querySelector('svg text')?.textContent).toBe('Alpha');
        await click(container.querySelector('svg g')); expect(openPage).toHaveBeenCalledWith('a');
        await act(async () => { await Promise.resolve(); emitAppEvent('gnosi:open-view-tools'); });
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    });
});
