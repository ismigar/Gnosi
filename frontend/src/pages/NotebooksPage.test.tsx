import {
    StrictMode,
    act,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
    type MockedFunction,
} from 'vitest';

import { NotebookDetail } from './NotebooksPage';

interface AgentChatProps {
    readonly contextRefs: unknown;
    readonly readOnly: boolean;
}

interface MountedRoot {
    readonly container: HTMLDivElement;
    readonly root: Root;
}

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

type FetchInput = Parameters<typeof fetch>[0];
type TranslationValues = Readonly<Record<string, unknown>>;

const mountedRoots: MountedRoot[] = [];
const originalFetch = globalThis.fetch;
const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;

const { translate } = vi.hoisted(() => {
    const replacement = (value: unknown, fallback: string): string => {
        if (typeof value === 'string') return value;
        if (typeof value === 'number') return value.toString();
        return fallback;
    };
    return {
        translate: (
            key: string,
            fallback?: string,
            values: TranslationValues = {},
        ): string => (fallback ?? key)
            .replace('{{revision}}', replacement(values.revision, '{{revision}}'))
            .replace('{{resources}}', replacement(values.resources, '{{resources}}'))
            .replace('{{sources}}', replacement(values.sources, '{{sources}}'))
            .replace('{{resource}}', replacement(values.resource, '{{resource}}'))
            .replace('{{time}}', replacement(values.time, '{{time}}'))
            .replace('{{count}}', replacement(values.count, '{{count}}'))
            .replace('{{notebooks}}', replacement(values.notebooks, '{{notebooks}}')),
    };
});

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));

vi.mock('../components/AgentChat', () => ({
    default: ({ readOnly, contextRefs }: AgentChatProps) => (
        <div
            data-testid="agent-chat"
            data-read-only={readOnly ? 'true' : 'false'}
            data-context={JSON.stringify(contextRefs)}
        >
            {readOnly ? 'Read-only conversation' : 'Editable conversation'}
        </div>
    ),
}));

vi.mock('../components/ConfirmModal', () => ({ default: () => null }));
vi.mock('../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

function asRequest(input: FetchInput, init: RequestInit = {}): Request {
    if (input instanceof Request) return input;
    const target = typeof input === 'string' ? input : input.href;
    return new Request(new URL(target, window.location.origin), init);
}

function jsonResponse(payload: unknown, status = 200): Response {
    return Response.json(payload, { status });
}

function installFetchMock(
    implementation: typeof fetch,
): MockedFunction<typeof fetch> {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(implementation);
    globalThis.fetch = fetchMock;
    return fetchMock;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
    return isUnknownArray(value)
        && value.every((item) => typeof item === 'string');
}

function requireButton(
    element: Element | null | undefined,
    description: string,
): HTMLButtonElement {
    if (!(element instanceof HTMLButtonElement)) {
        throw new Error(`Missing ${description} button`);
    }
    return element;
}

function readSelectedSourceIds(container: HTMLElement): readonly string[] {
    const chat = container.querySelector<HTMLElement>('[data-testid="agent-chat"]');
    if (!chat) throw new Error('Missing AgentChat test boundary');
    const parsed: unknown = JSON.parse(chat.dataset.context ?? '[]');
    if (!isUnknownArray(parsed)) throw new Error('Expected context references');
    const firstReference = parsed.at(0);
    if (!isRecord(firstReference) || !isRecord(firstReference.scope)) {
        throw new Error('Expected a scoped notebook context');
    }
    if (!isStringArray(firstReference.scope.source_ids)) {
        throw new Error('Expected selected source identifiers');
    }
    return firstReference.scope.source_ids;
}

async function renderNotebookDetail(
    strict = false,
    flushTurns = 2,
): Promise<HTMLDivElement> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    const detail = (
        <MemoryRouter>
            <NotebookDetail notebookId="notebook-1" />
        </MemoryRouter>
    );
    await act(async () => {
        root.render(strict ? <StrictMode>{detail}</StrictMode> : detail);
        for (let turn = 0; turn < flushTurns; turn += 1) {
            await Promise.resolve();
        }
    });
    return container;
}

beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
    globalThis.fetch = originalFetch;
    delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
});

afterEach(() => {
    vi.restoreAllMocks();
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) throw new Error('Missing mounted root during cleanup');
        act(() => {
            mounted.root.unmount();
        });
        mounted.container.remove();
    }
});

describe('NotebookDetail permissions', () => {
    it('gives workspace viewers a read-only transcript and no refresh action', async () => {
        const notebook = {
            id: 'notebook-1',
            title: 'Shared research',
            status: 'available',
            active_revision: 1,
            visibility: 'workspace',
            conversation_mode: 'shared',
            conversation_session_id: 'notebook-notebook-1-shared',
            resource_count: 1,
            source_counts: { total: 1, available: 1 },
            chat_ready: true,
            can_manage: false,
            can_chat: false,
            progress: null,
            last_error: null,
        };
        installFetchMock((input, init) => {
            const request = asRequest(input, init);
            return Promise.resolve(jsonResponse(request.url.includes('/chat-sources')
                ? { sources: [{ source_id: 'source-1', label: 'Source', kind: 'file', status: 'available' }], notebooks: [] }
                : request.url.includes('/sources?')
                    ? { items: [], total: 0, page: 1, page_size: 50, active_revision: 1 }
                    : notebook));
        });
        const container = await renderNotebookDetail();

        const agentChat = container.querySelector<HTMLElement>(
            '[data-testid="agent-chat"]',
        );
        expect(agentChat?.dataset.readOnly).toBe('true');
        expect([...container.querySelectorAll('button')]
            .some((button) => button.textContent.includes('Refresh'))).toBe(false);
    });

    it('retries only the selected Resource', async () => {
        const notebook = {
            id: 'notebook-1', title: 'Research', status: 'available', active_revision: 1,
            visibility: 'private', conversation_mode: 'private_member',
            conversation_session_id: 'notebook-notebook-1-private', resource_count: 1,
            source_counts: { total: 1, available: 1 }, chat_ready: true,
            can_manage: true, can_chat: true, progress: null, last_error: null,
        };
        const sourceData = {
            items: [{
                resource_id: 'resource-1', title: 'Broken source', state: 'error',
                error: 'Extraction failed', last_checked_at: '2026-08-21T10:00:00Z', sources: [],
            }],
            total: 1, page: 1, page_size: 50, active_revision: 1,
        };
        const fetchMock = installFetchMock((input, init) => {
            const request = asRequest(input, init);
            return Promise.resolve(jsonResponse(request.url.includes('/chat-sources')
                ? { sources: [{ source_id: 'source-1', label: 'Source', kind: 'file', status: 'available' }], notebooks: [] }
                : request.url.includes('/sources?') ? sourceData : notebook,
            request.method === 'POST' ? 202 : 200));
        });
        const container = await renderNotebookDetail();
        const retry = requireButton(
            container.querySelector('button[aria-label="Retry Resource"]'),
            'retry Resource',
        );
        await act(async () => {
            retry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        });

        const requests = fetchMock.mock.calls
            .map(([input, init]) => asRequest(input, init));
        expect(requests.some((request) => (
            new URL(request.url).pathname === '/api/notebooks/notebook-1/sources/resource-1/refresh'
            && request.method === 'POST'
        ))).toBe(true);
        expect(requests.some((request) => (
            new URL(request.url).pathname === '/api/notebooks/notebook-1/refresh'
            && request.method === 'POST'
        ))).toBe(false);
    });

    it('shows the current Resource and cancels active indexing', async () => {
        const notebook = {
            id: 'notebook-1', title: 'Research', status: 'indexing', active_revision: 1,
            visibility: 'private', conversation_mode: 'private_member',
            conversation_session_id: 'notebook-notebook-1-private', resource_count: 1,
            source_counts: { total: 1, available: 1 }, chat_ready: true,
            can_manage: true, can_chat: true, last_error: null,
            progress: {
                state: 'indexing', processed: 2, total: 5, percent: 40,
                current_resource_title: 'Lecture recording', cancellable: true,
            },
        };
        const fetchMock = installFetchMock((input, init) => {
            const request = asRequest(input, init);
            return Promise.resolve(jsonResponse(request.url.includes('/chat-sources')
                ? { sources: [{ source_id: 'source-1', label: 'Source', kind: 'file', status: 'available' }], notebooks: [] }
                : request.url.includes('/sources?')
                    ? { items: [], total: 0, page: 1, page_size: 50, active_revision: 1 }
                    : notebook));
        });
        const container = await renderNotebookDetail();
        expect(container.textContent).toContain('Current Resource: Lecture recording');
        const cancel = requireButton(
            [...container.querySelectorAll('button')]
                .find((button) => button.textContent.includes('Cancel indexing')),
            'cancel indexing',
        );
        await act(async () => {
            cancel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        });

        const cancelRequest = fetchMock.mock.calls
            .map(([input, init]) => asRequest(input, init))
            .find((request) => new URL(request.url).pathname === '/api/notebooks/notebook-1/refresh/cancel');
        if (!cancelRequest) throw new Error('Missing cancel indexing request');
        expect(cancelRequest.method).toBe('POST');
        expect(cancelRequest.credentials).toBe('include');
    });

    it('selects individual sources directly from left panel cards', async () => {
        const notebook = {
            id: 'notebook-1', title: 'Primary', status: 'available', active_revision: 2,
            visibility: 'private', conversation_mode: 'private_member',
            conversation_session_id: 'notebook-notebook-1-private', resource_count: 2,
            source_counts: { total: 2, available: 2 }, chat_ready: true,
            can_manage: true, can_chat: true, progress: null, last_error: null,
        };
        const sourceData = {
            items: [
                {
                    resource_id: 'resource-1',
                    title: 'Paper',
                    state: 'available',
                    sources: [{ source_id: 'source-a', label: 'Paper.pdf', kind: 'file', status: 'available' }],
                },
                {
                    resource_id: 'resource-2',
                    title: 'Article',
                    state: 'available',
                    sources: [{ source_id: 'source-b', label: 'Article', kind: 'url', status: 'available' }],
                },
            ],
            total: 2, page: 1, page_size: 50, active_revision: 2,
        };
        const chatSources = {
            sources: [
                { source_id: 'source-a', label: 'Paper.pdf', kind: 'file', status: 'available' },
                { source_id: 'source-b', label: 'Article', kind: 'url', status: 'available' },
            ],
            notebooks: [],
        };
        installFetchMock((input, init) => {
            const request = asRequest(input, init);
            const value = request.url;
            const payload = value.includes('/chat-sources')
                ? chatSources
                : value.includes('/sources?')
                    ? sourceData
                    : notebook;
            return Promise.resolve(jsonResponse(payload));
        });
        const container = await renderNotebookDetail(true, 3);
        const checkboxes = [
            ...container.querySelectorAll<HTMLInputElement>(
                '.notebook-source-checkbox',
            ),
        ];
        expect(checkboxes.length).toBeGreaterThanOrEqual(2);
        expect(checkboxes.every((input) => input.checked)).toBe(true);
        const firstCheckbox = checkboxes.at(0);
        if (!firstCheckbox) throw new Error('Missing first source checkbox');
        await act(async () => {
            firstCheckbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
        });

        expect(readSelectedSourceIds(container)).toEqual(['source-b']);
    });

    it('manages custom groups and toggles all sources in a group with group checkbox', async () => {
        const notebook = {
            id: 'notebook-1', title: 'Grouped Research', status: 'available', active_revision: 1,
            visibility: 'private', conversation_mode: 'private_member',
            conversation_session_id: 'notebook-notebook-1-private', resource_count: 2,
            source_counts: { total: 2, available: 2 }, chat_ready: true,
            can_manage: true, can_chat: true, progress: null, last_error: null,
            groups: [
                { id: 'grp-1', name: 'Primary Group', resource_ids: ['resource-1'] },
            ],
        };
        const sourceData = {
            items: [
                {
                    resource_id: 'resource-1',
                    title: 'Grouped Resource',
                    state: 'available',
                    sources: [{ source_id: 'source-1', label: 'file1.pdf', kind: 'file', status: 'available' }],
                },
                {
                    resource_id: 'resource-2',
                    title: 'Ungrouped Resource',
                    state: 'available',
                    sources: [{ source_id: 'source-2', label: 'file2.pdf', kind: 'file', status: 'available' }],
                },
            ],
            total: 2, page: 1, page_size: 50, active_revision: 1,
        };
        const chatSources = {
            sources: [
                { source_id: 'source-1', label: 'file1.pdf', kind: 'file', status: 'available' },
                { source_id: 'source-2', label: 'file2.pdf', kind: 'file', status: 'available' },
            ],
            notebooks: [],
        };
        const fetchMock = installFetchMock(async (input, init) => {
            const request = asRequest(input, init);
            const value = request.url;
            if (request.method === 'PATCH') {
                const body: unknown = await request.clone().json();
                if (!isRecord(body)) throw new Error('Expected a PATCH object body');
                return jsonResponse({ ...notebook, ...body });
            }
            const payload = value.includes('/chat-sources')
                ? chatSources
                : value.includes('/sources?')
                    ? sourceData
                    : notebook;
            return jsonResponse(payload);
        });
        const container = await renderNotebookDetail(false, 3);

        // Verify group header exists
        expect(container.textContent).toContain('Primary Group');
        expect(container.textContent).toContain('Ungrouped');

        // Toggle group-level checkbox (which targets grp-1 containing resource-1 -> source-1)
        const groupCheckbox = container.querySelector<HTMLInputElement>(
            '.notebook-custom-group__header .notebook-source-checkbox',
        );
        if (!groupCheckbox) throw new Error('Missing custom-group checkbox');
        expect(groupCheckbox.checked).toBe(true);

        await act(async () => {
            groupCheckbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
        });

        // Chat context should now only have source-2
        expect(readSelectedSourceIds(container)).toEqual(['source-2']);

        // Move ungrouped resource to group
        const select = container.querySelector<HTMLSelectElement>(
            '.notebook-ungrouped-section .notebook-group-select',
        );
        if (!select) throw new Error('Missing ungrouped Resource selector');
        await act(async () => {
            select.value = 'grp-1';
            select.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });

        const patchRequest = fetchMock.mock.calls
            .map(([input, init]) => asRequest(input, init))
            .find((request) => (
                new URL(request.url).pathname === '/api/notebooks/notebook-1'
                && request.method === 'PATCH'
            ));
        if (!patchRequest) throw new Error('Missing notebook group PATCH request');
        await expect(patchRequest.clone().json()).resolves.toEqual({
            groups: [{ id: 'grp-1', name: 'Primary Group', resource_ids: ['resource-1', 'resource-2'] }],
        });
    });
});
