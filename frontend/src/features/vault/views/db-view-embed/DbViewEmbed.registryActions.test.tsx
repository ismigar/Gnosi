import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetBrowserTestStorage } from '../../../../../tests/browser-storage';
import { DbViewEmbed } from '../DbViewEmbed';
import { VaultEditorContext, type VaultEditorContextValue } from '../../../../shared/editor/VaultEditorContext';
import type { VaultViewBodyProps } from '../VaultViewBody';
import { defineStorageKey, removeStorage, stringStorageCodec } from '../../../../shared/platform/browser-storage';
import { pinnedKey, readText, selectedKey } from './preferences';
import * as api from './api';
import type { EmbedView } from './types';

const fixture = vi.hoisted(() => ({ body: undefined as VaultViewBodyProps | undefined }));
vi.mock('./api', () => ({
    fetchPageViews: vi.fn(), fetchVaultViews: vi.fn(), fetchVaultPagesByTable: vi.fn(), fetchVaultPage: vi.fn(),
    createPageInTable: vi.fn(), updateVaultView: vi.fn(), createVaultView: vi.fn(), fetchVaultViewUsage: vi.fn(), deleteVaultView: vi.fn(),
    deleteVaultPage: vi.fn(), applyVaultTemplate: vi.fn(), patchPageMetadata: vi.fn(), patchSectionConfig: vi.fn(),
    apiErrorDetail: (_error: unknown, fallback: string) => fallback,
    apiErrorStatus: () => undefined,
}));
vi.mock('./diagnostics', () => ({ reportEmbedError: vi.fn() }));
vi.mock('../../../literature/records/ReferenceImportExport', () => ({ ReferenceImportExport: () => <span>Reference IO</span> }));
vi.mock('../../../agent/inbox/BrainTools', () => ({ BrainTools: () => null }));
vi.mock('../../../../shared/ui/previews/IconRenderer', () => ({ IconRenderer: () => <span>icon</span> }));
vi.mock('../VaultViewBody', () => ({ VaultViewBody: (props: VaultViewBodyProps) => {
    fixture.body = props;
    return <div data-testid="body">{props.notes?.map(note => <span key={note.id}>{note.title}</span>)}</div>;
} }));
vi.mock('../../../../shared/i18n/useLocaleSettings', () => ({
    useLocaleSettings: () => ({ currencyCode: 'EUR', dateFormat: 'locale', dateLocale: 'en-US', decimalSymbol: '.', numberLocale: 'en-US' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key }) }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const anchor: EmbedView = { id: 'anchor', name: 'Main', table_id: 'books', type: 'table', visibleProperties: ['title'], tabs: ['other'] };
const other: EmbedView = { id: 'other', name: 'Other', table_id: 'books', type: 'table', visibleProperties: ['title'] };
let container: HTMLDivElement;
let root: Root;
let context: VaultEditorContextValue;

beforeEach(() => {
    vi.resetAllMocks(); fixture.body = undefined;
    resetBrowserTestStorage('session');
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => { callback(0); }, 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { window.clearTimeout(id); });
    vi.mocked(api.fetchPageViews).mockResolvedValue({ page_id: 'page', sections: [{ view_id: 'anchor', heading: 'Library', source_table_id: 'books', view_type: 'table', visible_properties: ['title'] }] });
    vi.mocked(api.fetchVaultViews).mockResolvedValue([anchor, other]);
    vi.mocked(api.fetchVaultPagesByTable).mockResolvedValue([{ id: 'a', title: 'Alpha', metadata: {} }, { id: 'b', title: 'Beta', metadata: {} }]);
    vi.mocked(api.updateVaultView).mockResolvedValue({ status: 'ok' });
    vi.mocked(api.deleteVaultView).mockResolvedValue({ status: 'ok' });
    vi.mocked(api.fetchVaultViewUsage).mockResolvedValue({ count: 0, pages: [], view_id: 'other' });
    context = { pageId: 'page', registry: { databases: [], tables: [{ id: 'books', properties: [{ name: 'title', type: 'title' }] }], views: [anchor, other] }, allTables: [], idToTitle: {}, onCreateRecord: null, onDeletePage: null, onEditSchema: null, onOpenParallel: null, viewSectionNonce: 0 };
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
    await act(async () => { root.unmount(); await Promise.resolve(); });
    container.remove(); vi.unstubAllGlobals();
    for (const key of [pinnedKey('page', 'anchor'), selectedKey('page', 'anchor'), 'gnosi.view.lastLoad.page.anchor']) removeStorage(defineStorageKey(key, stringStorageCodec));
});
async function render(): Promise<void> {
    await act(async () => { root.render(<VaultEditorContext.Provider value={context}><DbViewEmbed block={{ id: 'block', props: { view_id: 'anchor' } }} /></VaultEditorContext.Provider>); await Promise.resolve(); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
}
async function click(element: Element | null | undefined): Promise<void> {
    if (!element) throw new Error('Missing clickable element');
    await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve(); });
}
function button(label: string): HTMLButtonElement | undefined {
    return [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent.trim() === label || element.getAttribute('aria-label') === label);
}
async function renameOther(name = 'Renamed', menuIndex = 1): Promise<void> {
    await click(container.querySelectorAll('button[aria-label="View options"]')[menuIndex]);
    await click(button('Rename'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    const input = document.querySelector<HTMLInputElement>('input[type="text"]');
    if (!input) throw new Error('Missing rename input');
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, name);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await Promise.resolve();
    });
    await click(button('Rename'));
}
async function saveTwoRecords(assertCurrent: () => void): Promise<void> {
    for (const id of ['a', 'b']) {
        await act(async () => { await fixture.body?.onUpdateNote?.(id, { metadata: { timeline_order: 1 } }); });
        assertCurrent();
    }
}

it.each(['rename', 'delete', 'duplicate'])('retains a successful %s through two record-save reloads', async action => {
    await render();
    let expectedTitle = 'Renamed';
    if (action === 'rename') {
        vi.mocked(api.fetchVaultViews).mockResolvedValue([anchor, { ...other, displayTitle: 'Renamed' }]);
        await renameOther();
        expect(api.updateVaultView).toHaveBeenCalledWith('other', { displayTitle: 'Renamed' });
    } else {
        await click(container.querySelectorAll('button[aria-label="View options"]')[1]);
        if (action === 'delete') {
            vi.mocked(api.fetchVaultViews).mockResolvedValue([anchor]);
            await click(button('Delete everywhere…')); await click(button('Delete'));
            expect(api.deleteVaultView).toHaveBeenCalledWith('other');
        } else {
            expectedTitle = 'Other copy';
            vi.mocked(api.createVaultView).mockResolvedValue({ id: 'copy' });
            vi.mocked(api.fetchVaultViews).mockResolvedValue([anchor, other, { ...other, id: 'copy', name: expectedTitle }]);
            await click(button('Duplicate'));
            expect(api.createVaultView).toHaveBeenCalledTimes(1);
        }
    }
    const assertCurrent = () => {
        if (action === 'delete') expect(container.textContent).not.toContain('Other');
        else expect(container.textContent).toContain(expectedTitle);
        if (action === 'duplicate') expect(fixture.body?.activeView?.id).toBe('copy');
    };
    assertCurrent();
    vi.mocked(api.fetchVaultViews).mockResolvedValue([anchor, other]);
    await saveTwoRecords(assertCurrent);
    expect(api.fetchVaultViews).toHaveBeenCalledTimes(1);
    expect(api.fetchVaultPagesByTable).toHaveBeenCalledTimes(3);
});

it('retains a newly saved view through two record-save reloads', async () => {
    const created = { ...other, id: 'new-tab', name: 'Created view' };
    context = { ...context, onOpenViewConfig: (_input: unknown, save: unknown) => {
        if (typeof save === 'function') Reflect.apply(save, undefined, [created]);
    } };
    await render();
    await click(button('Add view')); await click(button('Create a new view'));
    const assertCurrent = () => {
        expect(container.textContent).toContain('Created view');
        expect(fixture.body?.activeView?.id).toBe('new-tab');
    };
    assertCurrent();
    await saveTwoRecords(assertCurrent);
    expect(api.fetchVaultViews).not.toHaveBeenCalled();
});

it('does not publish a tab refresh that completes after the editor changes page', async () => {
    await render();
    let finish: ((views: EmbedView[]) => void) | undefined;
    vi.mocked(api.fetchVaultViews).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await renameOther();
    context = { ...context, pageId: 'next-page', registry: { ...context.registry, views: [anchor, { ...other, displayTitle: 'Current page' }] } };
    await render();
    expect(container.textContent).toContain('Current page');
    await act(async () => { finish?.([anchor, { ...other, displayTitle: 'Stale rename' }]); await Promise.resolve(); });
    expect(container.textContent).toContain('Current page');
    expect(container.textContent).not.toContain('Stale rename');
    await saveTwoRecords(() => { expect(container.textContent).toContain('Current page'); });
});

it('keeps a newer tab registry when an older configuration load finishes afterwards', async () => {
    await render();
    let finish: ((views: EmbedView[]) => void) | undefined;
    vi.mocked(api.fetchVaultViews).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    context = { ...context, viewSectionNonce: 1 };
    await render();
    expect(api.fetchVaultViews).toHaveBeenCalledTimes(1);
    vi.mocked(api.fetchVaultViews).mockResolvedValue([anchor, { ...other, displayTitle: 'Renamed' }]);
    await renameOther();
    expect(container.textContent).toContain('Renamed');
    await act(async () => { finish?.([anchor, other]); await Promise.resolve(); });
    expect(container.textContent).toContain('Renamed');
    await saveTwoRecords(() => { expect(container.textContent).toContain('Renamed'); });
    expect(api.fetchVaultViews).toHaveBeenCalledTimes(2);
});

it.each(['rename', 'delete', 'duplicate'])('rejects an older rename snapshot after a newer %s registry is published', async action => {
    await render();
    let finishFirst: ((views: EmbedView[]) => void) | undefined;
    vi.mocked(api.fetchVaultViews).mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve; }));
    await renameOther('First');
    expect(api.fetchVaultViews).toHaveBeenCalledTimes(1);
    if (action === 'rename') {
        vi.mocked(api.fetchVaultViews).mockResolvedValue([anchor, { ...other, displayTitle: 'Second' }]);
        await renameOther('Second');
    } else {
        await click(container.querySelectorAll('button[aria-label="View options"]')[1]);
        if (action === 'delete') {
            vi.mocked(api.fetchVaultViews).mockResolvedValue([anchor]);
            await click(button('Delete everywhere…')); await click(button('Delete'));
        } else {
            vi.mocked(api.createVaultView).mockResolvedValue({ id: 'copy' });
            vi.mocked(api.fetchVaultViews).mockResolvedValue([anchor, other, { ...other, id: 'copy', name: 'New copy' }]);
            await click(button('Duplicate'));
        }
    }
    const assertCurrent = () => {
        expect(container.textContent).not.toContain('First');
        if (action === 'rename') expect(container.textContent).toContain('Second');
        else if (action === 'delete') expect(container.textContent).not.toContain('Other');
        else {
            expect(container.textContent).toContain('New copy');
            expect(fixture.body?.activeView?.id).toBe('copy');
        }
    };
    assertCurrent();
    expect(api.fetchVaultViews).toHaveBeenCalledTimes(2);
    await act(async () => { finishFirst?.([anchor, { ...other, displayTitle: 'First' }]); await Promise.resolve(); });
    assertCurrent();
    await saveTwoRecords(assertCurrent);
    expect(api.fetchVaultViews).toHaveBeenCalledTimes(2);
});

it('keeps the newer registry when an earlier action read fails afterwards', async () => {
    await render();
    let failFirst: ((reason: Error) => void) | undefined;
    vi.mocked(api.fetchVaultViews).mockReturnValueOnce(new Promise((_resolve, reject) => { failFirst = reject; }));
    await renameOther('First');
    vi.mocked(api.fetchVaultViews).mockResolvedValue([anchor, { ...other, displayTitle: 'Second' }]);
    await renameOther('Second');
    await act(async () => { failFirst?.(new Error('obsolete request failed')); await Promise.resolve(); });
    expect(container.textContent).toContain('Second');
    await saveTwoRecords(() => { expect(container.textContent).toContain('Second'); });
    expect(api.fetchVaultViews).toHaveBeenCalledTimes(2);
});

it('does not let an older full action snapshot erase a newly saved view', async () => {
    const created = { ...other, id: 'new-tab', name: 'Created view' };
    context = { ...context, onOpenViewConfig: (_input: unknown, save: unknown) => {
        if (typeof save === 'function') Reflect.apply(save, undefined, [created]);
    } };
    await render();
    let finishFirst: ((views: EmbedView[]) => void) | undefined;
    vi.mocked(api.fetchVaultViews).mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve; }));
    await renameOther('First');
    await click(button('Add view')); await click(button('Create a new view'));
    expect(container.textContent).toContain('Created view');
    vi.mocked(api.fetchVaultViews).mockResolvedValue([anchor, { ...other, displayTitle: 'First' }, created]);
    await act(async () => { finishFirst?.([anchor, { ...other, displayTitle: 'First' }]); await Promise.resolve(); });
    const assertCurrent = () => {
        expect(container.textContent).toContain('Created view');
        expect(fixture.body?.activeView?.id).toBe('new-tab');
    };
    assertCurrent();
    await saveTwoRecords(assertCurrent);
    expect(container.textContent).toContain('First');
    expect(api.fetchVaultViews).toHaveBeenCalledTimes(2);
});

it('rejects an older action snapshot after a newer configuration retry publishes', async () => {
    await render();
    vi.mocked(api.fetchVaultViews).mockRejectedValueOnce(new Error('retry configuration later'));
    context = { ...context, viewSectionNonce: 1 };
    await render();
    let finishFirst: ((views: EmbedView[]) => void) | undefined;
    vi.mocked(api.fetchVaultViews).mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve; }));
    await renameOther('First');
    vi.mocked(api.fetchVaultViews).mockResolvedValue([anchor, { ...other, displayTitle: 'Second' }]);
    await act(async () => { await fixture.body?.onUpdateNote?.('a', { metadata: { timeline_order: 1 } }); });
    expect(container.textContent).toContain('Second');
    await act(async () => { finishFirst?.([anchor, { ...other, displayTitle: 'First' }]); await Promise.resolve(); });
    expect(container.textContent).not.toContain('First');
    await saveTwoRecords(() => { expect(container.textContent).toContain('Second'); });
    expect(api.fetchVaultViews).toHaveBeenCalledTimes(3);
});

it('retries the latest failed action read once on the next record save', async () => {
    await render();
    vi.mocked(api.fetchVaultViews).mockRejectedValueOnce(new Error('temporary action refresh failure'));
    await renameOther();
    vi.mocked(api.fetchVaultViews).mockResolvedValue([anchor, { ...other, displayTitle: 'Renamed' }]);
    await saveTwoRecords(() => { expect(container.textContent).toContain('Renamed'); });
    expect(api.fetchVaultViews).toHaveBeenCalledTimes(2);
});

it('keeps an in-flight duplicate refresh valid while a record reload uses the cached registry', async () => {
    await render();
    vi.mocked(api.createVaultView).mockResolvedValue({ id: 'copy' });
    let finish: ((views: EmbedView[]) => void) | undefined;
    vi.mocked(api.fetchVaultViews).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await click(container.querySelectorAll('button[aria-label="View options"]')[1]);
    await click(button('Duplicate'));
    await act(async () => { await fixture.body?.onUpdateNote?.('a', { metadata: { timeline_order: 1 } }); });
    expect(api.fetchVaultViews).toHaveBeenCalledTimes(1);
    await act(async () => { finish?.([anchor, other, { ...other, id: 'copy', name: 'New copy' }]); await Promise.resolve(); });
    const assertCurrent = () => {
        expect(container.textContent).toContain('New copy');
        expect(fixture.body?.activeView?.id).toBe('copy');
    };
    assertCurrent();
    await saveTwoRecords(assertCurrent);
    expect(api.fetchVaultViews).toHaveBeenCalledTimes(1);
});

it.each(['duplicate', 'delete'])('completes a successful %s when a newer same-scope read supersedes its snapshot', async action => {
    const third = { ...other, id: 'third', name: 'Third' };
    const scopedAnchor = action === 'delete' ? { ...anchor, tabs: ['other', 'third'] } : anchor;
    if (action === 'delete') context = { ...context, registry: { ...context.registry, views: [scopedAnchor, other, third] } };
    await render();
    await click(container.querySelectorAll('button[aria-label="View options"]')[1]?.parentElement);
    let finish: ((views: EmbedView[]) => void) | undefined;
    vi.mocked(api.fetchVaultViews).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await click(container.querySelectorAll('button[aria-label="View options"]')[1]);
    const copy = { ...other, id: 'copy', name: 'Copied view' };
    if (action === 'duplicate') {
        vi.mocked(api.createVaultView).mockResolvedValue({ id: 'copy' });
        await click(button('Duplicate'));
    } else {
        await click(button('Delete everywhere…')); await click(button('Delete'));
        expect(api.deleteVaultView).toHaveBeenCalledWith('other');
    }
    expect(api.fetchVaultViews).toHaveBeenCalledTimes(1);
    const newer = action === 'duplicate'
        ? [anchor, { ...other, displayTitle: 'Newer title' }, copy]
        : [{ ...scopedAnchor, displayTitle: 'Newer title' }, third];
    vi.mocked(api.fetchVaultViews).mockResolvedValue(newer);
    await renameOther('Newer title', action === 'duplicate' ? 1 : 0);
    expect(api.fetchVaultViews).toHaveBeenCalledTimes(2);
    await act(async () => { finish?.(action === 'duplicate' ? [anchor, other, copy] : [scopedAnchor, third]); await Promise.resolve(); });
    const assertCurrent = () => {
        expect(container.textContent).toContain('Newer title');
        const title = action === 'duplicate' ? 'Copied view' : 'Newer title';
        const selectedTab = [...container.querySelectorAll('span')].find(span => span.textContent === title)?.parentElement;
        expect(selectedTab?.className).toContain('font-semibold');
        expect(fixture.body?.activeView?.id).toBe(action === 'duplicate' ? 'copy' : 'anchor');
        if (action === 'duplicate') expect(readText(pinnedKey('page', 'anchor'))).toContain('copy');
        else expect(container.textContent).not.toContain('Other');
    };
    assertCurrent();
    await saveTwoRecords(assertCurrent);
    expect(api.fetchVaultViews).toHaveBeenCalledTimes(2);
});

it('pins and selects a successful duplicate after its failed refresh reconciles on a record save', async () => {
    await render();
    vi.mocked(api.createVaultView).mockResolvedValue({ id: 'copy' });
    vi.mocked(api.fetchVaultViews).mockRejectedValueOnce(new Error('duplicate registry refresh failed'));
    await click(container.querySelectorAll('button[aria-label="View options"]')[1]);
    await click(button('Duplicate'));
    expect(api.createVaultView).toHaveBeenCalledTimes(1);
    expect(readText(pinnedKey('page', 'anchor'))).toContain('copy');
    vi.mocked(api.fetchVaultViews).mockResolvedValue([anchor, other, { ...other, id: 'copy', name: 'Reconciled copy' }]);
    await saveTwoRecords(() => {
        expect(container.textContent).toContain('Reconciled copy');
        expect(fixture.body?.activeView?.id).toBe('copy');
    });
    expect(api.fetchVaultViews).toHaveBeenCalledTimes(2);
});

it.each(['duplicate', 'delete'])('does not complete an old-scope %s in a different editor page', async action => {
    await render();
    await click(container.querySelectorAll('button[aria-label="View options"]')[1]?.parentElement);
    let finish: ((views: EmbedView[]) => void) | undefined;
    vi.mocked(api.fetchVaultViews).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await click(container.querySelectorAll('button[aria-label="View options"]')[1]);
    if (action === 'duplicate') {
        vi.mocked(api.createVaultView).mockResolvedValue({ id: 'copy' });
        await click(button('Duplicate'));
    } else { await click(button('Delete everywhere…')); await click(button('Delete')); }
    context = { ...context, pageId: 'next-page', registry: { ...context.registry, views: [anchor, { ...other, displayTitle: 'Current other' }] } };
    await render();
    await click(container.querySelectorAll('button[aria-label="View options"]')[1]?.parentElement);
    await act(async () => { finish?.(action === 'duplicate' ? [anchor, other, { ...other, id: 'copy', name: 'Old copy' }] : [anchor]); await Promise.resolve(); });
    const assertCurrent = () => {
        expect(fixture.body?.activeView?.id).toBe('other');
        const selectedTab = [...container.querySelectorAll('span')].find(span => span.textContent === 'Current other')?.parentElement;
        expect(selectedTab?.className).toContain('font-semibold');
        expect(container.textContent).not.toContain('Old copy');
        expect(readText(pinnedKey('page', 'anchor')) || '').not.toContain('copy');
    };
    assertCurrent();
    await saveTwoRecords(assertCurrent);
});

it('keeps the current selected tab when deletion finishes after the user selects a surviving view', async () => {
    const third = { ...other, id: 'third', name: 'Third' };
    const scopedAnchor = { ...anchor, tabs: ['other', 'third'] };
    context = { ...context, registry: { ...context.registry, views: [scopedAnchor, other, third] } };
    await render();
    await click(container.querySelectorAll('button[aria-label="View options"]')[1]?.parentElement);
    let finish: ((views: EmbedView[]) => void) | undefined;
    vi.mocked(api.fetchVaultViews).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await click(container.querySelectorAll('button[aria-label="View options"]')[1]);
    await click(button('Delete everywhere…')); await click(button('Delete'));
    await click(container.querySelectorAll('button[aria-label="View options"]')[2]?.parentElement);
    await act(async () => { finish?.([scopedAnchor, third]); await Promise.resolve(); });
    expect(fixture.body?.activeView?.id).toBe('third');
    await saveTwoRecords(() => { expect(fixture.body?.activeView?.id).toBe('third'); });
});
