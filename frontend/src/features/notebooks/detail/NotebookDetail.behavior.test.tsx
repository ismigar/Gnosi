import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotebookDetail } from './NotebookDetail';
import * as api from '../../../shared/api/notebooks';
import { transportFetch } from '../../../shared/api/transports';
import { GnosiApiError } from '../../../shared/api/errors';
import { toast } from '../../../lib/toast';
import { vaultPath } from '../../../lib/vaultRouting';
import { removeStorage, writeStorage } from '../../../shared/platform/browser-storage';
import { NOTEBOOK_USER_ID } from './notebookModel';
import { chatSourcesFixture, notebookFixture, resourcesFixture, sourcesFixture } from './notebookTestFixtures';
import type { NotebookChatContext } from './notebookTypes';

const { translate, chatMount } = vi.hoisted(() => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
    chatMount: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock('../../../shared/api/notebooks', () => ({
    fetchNotebook: vi.fn(), fetchNotebookSources: vi.fn(), fetchNotebookChatSources: vi.fn(),
    fetchReferenceResources: vi.fn(), addNotebookSources: vi.fn(), updateNotebook: vi.fn(),
    refreshNotebook: vi.fn(), refreshNotebookSource: vi.fn(), cancelNotebookRefresh: vi.fn(),
    removeNotebookSource: vi.fn(), deleteNotebook: vi.fn(),
}));
vi.mock('../../../shared/api/transports', () => ({ transportFetch: vi.fn() }));
vi.mock('../../../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../lib/notifyError', () => ({ notifyError: vi.fn() }));
vi.mock('../../agent', async () => {
    const { useEffect } = await import('react');
    return { AgentChat: function TestAgentChat({ contextRefs, storageIdentity, forcedSessionId }: { contextRefs: NotebookChatContext[]; storageIdentity: string; forcedSessionId: string }) {
        useEffect(() => { chatMount(); }, []);
        return <div data-chat data-context={JSON.stringify(contextRefs)} data-identity={storageIdentity} data-session={forcedSessionId}>Conversation boundary</div>;
    } };
});

let container: HTMLDivElement;
let root: Root;
const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

beforeEach(() => {
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.mocked(api.fetchNotebook).mockResolvedValue(notebookFixture());
    vi.mocked(api.fetchNotebookSources).mockResolvedValue(sourcesFixture());
    vi.mocked(api.fetchNotebookChatSources).mockResolvedValue(chatSourcesFixture());
    vi.mocked(api.fetchReferenceResources).mockImplementation((query) => Promise.resolve({ ...resourcesFixture(), page: query?.page ?? 1 }));
    vi.mocked(api.addNotebookSources).mockResolvedValue(notebookFixture());
    vi.mocked(api.updateNotebook).mockImplementation((_id, patch) => Promise.resolve(notebookFixture({
        ...(typeof patch.title === 'string' ? { title: patch.title } : {}),
    })));
    vi.mocked(api.deleteNotebook).mockResolvedValue(undefined);
    vi.mocked(transportFetch).mockResolvedValue(new Response(null, { status: 204 }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    removeStorage(NOTEBOOK_USER_ID);
    delete reactGlobal.IS_REACT_ACT_ENVIRONMENT;
    vi.useRealTimers();
    vi.restoreAllMocks();
});

async function renderDetail() {
    await act(async () => {
        root.render(<MemoryRouter initialEntries={['/vault/notebooks/notebook-1']}><Routes>
            <Route path="/vault/notebooks/:notebookId" element={<NotebookDetail notebookId="notebook-1" />} />
            <Route path={vaultPath('notebooks')} element={<div>Library destination</div>} />
        </Routes></MemoryRouter>);
        await Promise.resolve();
    });
}

function element<T extends Element>(selector: string, constructor: { new(): T }): T {
    const found = container.querySelector(selector);
    if (!(found instanceof constructor)) throw new Error(`Missing element ${selector}`);
    return found;
}

async function click(selector: string) {
    await act(async () => {
        element(selector, HTMLElement).click();
        await Promise.resolve();
    });
}

async function changeSelect(selector: string, value: string) {
    await act(async () => {
        const select = element(selector, HTMLSelectElement);
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await Promise.resolve();
    });
}

describe('NotebookDetail behavior', () => {
    it('reconciles source revisions before publishing detail and retains page parameters', async () => {
        vi.mocked(api.fetchNotebookSources).mockResolvedValueOnce({ ...sourcesFixture(), active_revision: 0 });
        await renderDetail();
        expect(api.fetchNotebook).toHaveBeenCalledWith('notebook-1', true);
        expect(api.fetchNotebookSources).toHaveBeenCalledTimes(2);
        expect(api.fetchNotebookSources).toHaveBeenLastCalledWith('notebook-1', { page: 1, pageSize: 50 });
        expect(container.textContent).toContain('Paper');
    });

    it('paginates sources without requesting refresh', async () => {
        vi.mocked(api.fetchNotebookSources).mockResolvedValue({ ...sourcesFixture(), total: 75 });
        await renderDetail();
        await click('nav[aria-label="Source pages"] button:last-child');
        expect(api.fetchNotebookSources).toHaveBeenLastCalledWith('notebook-1', { page: 2, pageSize: 50 });
        expect(api.fetchNotebook).toHaveBeenLastCalledWith('notebook-1', false);
    });

    it('keeps identity/session and exposes empty then restored source selection', async () => {
        writeStorage(NOTEBOOK_USER_ID, 'member-42');
        await renderDetail();
        expect(element('[data-chat]', HTMLElement).dataset.identity).toBe('member-42');
        expect(element('[data-chat]', HTMLElement).dataset.session).toBe('session / one');
        await click('button[aria-label="Clear selection"]');
        expect(container.querySelector('[data-chat]')).toBeNull();
        expect(container.textContent).toContain('Choose at least one source');
        await click('button[aria-label="Select all sources"]');
        expect(element('[data-chat]', HTMLElement).dataset.context).toContain('source-c');
    });

    it('marks partial group selection and preserves collapsed resources', async () => {
        await renderDetail();
        await click('input[aria-label="source-a"]');
        expect(element('input[aria-label="Primary"]', HTMLInputElement).indeterminate).toBe(true);
        await click('button[aria-label="Collapse"]');
        expect(container.querySelector('.notebook-custom-group__body')).toBeNull();
        await click('button[aria-label="Expand"]');
        expect(element('input[aria-label="source-a"]', HTMLInputElement).checked).toBe(false);
    });

    it('moves focus between tabs using arrows, Home and End', async () => {
        await renderDetail();
        const keys = [['sources', 'ArrowLeft', 'settings'], ['settings', 'Home', 'sources'], ['sources', 'End', 'settings']];
        for (const [from, key, to] of keys) {
            await act(async () => {
                element(`#notebook-${from ?? ''}-tab`, HTMLButtonElement).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
                await Promise.resolve();
            });
            expect(element(`#notebook-${to ?? ''}-tab`, HTMLButtonElement).getAttribute('aria-selected')).toBe('true');
            expect(document.activeElement).toBe(element(`#notebook-${to ?? ''}-tab`, HTMLElement));
        }
    });

    it('keeps resource selections through filtering/paging and excludes existing resources', async () => {
        await renderDetail();
        await click('button[aria-label="Add Resources"]');
        expect(container.textContent).not.toContain('Existing Resource');
        await click('.notebook-resource-row');
        await changeSelect('.notebook-resource-filter select', 'paper');
        expect(api.fetchReferenceResources).toHaveBeenLastCalledWith({ notebookId: 'notebook-1', query: '', page: 1, pageSize: 50, author: undefined, resourceType: 'paper', tag: undefined }, expect.any(AbortSignal));
        await click('button[aria-label="Next"]');
        expect(vi.mocked(api.fetchReferenceResources).mock.calls.at(-1)?.[0]?.page).toBe(2);
        expect(element('.notebook-resource-row', HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
        await click('.notebook-modal__footer .btn-gnosi-primary');
        expect(api.addNotebookSources).toHaveBeenCalledWith('notebook-1', ['resource-3']);
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('keeps the resource dialog open and selection intact on add failure', async () => {
        vi.mocked(api.addNotebookSources).mockRejectedValueOnce(new Error('offline'));
        await renderDetail();
        await click('button[aria-label="Add Resources"]');
        await click('.notebook-resource-row');
        await click('.notebook-modal__footer .btn-gnosi-primary');
        expect(toast.error).toHaveBeenCalledWith('Resources could not be added.');
        expect(element('.notebook-resource-row', HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
        expect(element('.notebook-modal__footer .btn-gnosi-primary', HTMLButtonElement).disabled).toBe(false);
    });

    it('patches settings and reports recoverable errors', async () => {
        vi.mocked(api.updateNotebook).mockRejectedValueOnce(new Error('offline'));
        await renderDetail();
        await changeSelect('#notebook-settings-panel select', 'workspace');
        expect(api.updateNotebook).toHaveBeenCalledWith('notebook-1', { visibility: 'workspace' });
        expect(toast.error).toHaveBeenCalledWith('Notebook settings could not be saved.');
    });

    it('clears the exact conversation checkpoint and remounts the chat boundary', async () => {
        await renderDetail();
        const initialMounts = chatMount.mock.calls.length;
        await click('.notebook-clear-conversation');
        await click('[role="dialog"] .mt-2 button:last-child');
        expect(transportFetch).toHaveBeenCalledWith('/api/chat/sessions/gnosy/session%20%2F%20one?notebook_id=notebook-1', { method: 'DELETE' });
        expect(chatMount.mock.calls.length).toBe(initialMounts + 1);
    });

    it('returns to the library on a missing notebook', async () => {
        vi.mocked(api.fetchNotebook).mockRejectedValueOnce(new GnosiApiError(new Response(null, { status: 404 }), 'Not found'));
        await renderDetail();
        expect(container.textContent).toContain('Library destination');
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('intersects the existing selection with authorized sources after a revision change', async () => {
        await renderDetail();
        await click('input[aria-label="source-a"]');
        vi.mocked(api.fetchNotebookChatSources).mockResolvedValue({ ...chatSourcesFixture(), active_revision: 2, sources: chatSourcesFixture().sources.filter((source) => source.source_id !== 'source-c') });
        vi.mocked(api.updateNotebook).mockResolvedValue(notebookFixture({ active_revision: 2 }));
        await changeSelect('#notebook-settings-panel select', 'workspace');
        const context = element('[data-chat]', HTMLElement).dataset.context ?? '';
        expect(context).toContain('source-b');
        expect(context).not.toContain('source-a');
        expect(context).not.toContain('source-c');
    });

    it('polls indexing every 1500 ms only while the document is visible', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        vi.mocked(api.fetchNotebook).mockResolvedValue(notebookFixture({ progress: {
            state: 'indexing', processed: 0, total: 2, percent: 0, revision: 2, cancellable: true,
            cancel_requested_at: null, current_resource_id: null, current_resource_title: null, error: null, job_id: 'job',
        } }));
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        await renderDetail();
        const initialCalls = vi.mocked(api.fetchNotebook).mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
        expect(api.fetchNotebook).toHaveBeenCalledTimes(initialCalls + 1);
        expect(api.fetchNotebook).toHaveBeenLastCalledWith('notebook-1', false);
        visibility.mockReturnValue('hidden');
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
        expect(api.fetchNotebook).toHaveBeenCalledTimes(initialCalls + 1);
    });

    it('keeps clear confirmation open after a failed checkpoint response', async () => {
        vi.mocked(transportFetch).mockResolvedValue(new Response(null, { status: 500 }));
        await renderDetail();
        const initialMounts = chatMount.mock.calls.length;
        await click('.notebook-clear-conversation');
        await click('[role="dialog"] .mt-2 button:last-child');
        expect(toast.error).toHaveBeenCalledWith('The conversation could not be cleared.');
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
        expect(chatMount.mock.calls.length).toBe(initialMounts);
    });

    it('reports unavailable chat sources and keeps the initial all-source context', async () => {
        vi.mocked(api.fetchNotebookChatSources).mockRejectedValueOnce(new Error('offline'));
        await renderDetail();
        expect(toast.error).toHaveBeenCalledWith('Conversation sources could not be loaded.');
        expect(element('[data-chat]', HTMLElement).dataset.context).toContain('"selection":"all"');
    });
});
