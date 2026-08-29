import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
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

import { dispatchWindowEvent } from '../../shared/platform/browser-events';
import NotebookCreateDialog, {
    type NotebookCreateDialogProps,
} from './NotebookCreateDialog';

interface MountedRoot {
    readonly container: HTMLDivElement;
    readonly root: Root;
}

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

type FetchInput = Parameters<typeof fetch>[0];
type TranslationValues = Readonly<Record<string, unknown>>;

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;
const originalFetch = globalThis.fetch;
const mountedRoots: MountedRoot[] = [];

const { translate } = vi.hoisted(() => {
    const replaceValue = (value: unknown, fallback: string): string => {
        if (typeof value === 'string') return value;
        if (typeof value === 'number') return value.toString();
        return fallback;
    };
    return { translate: (
        key: string,
        fallback?: string,
        values: TranslationValues = {},
    ): string => (fallback || key)
        .replace('{{count}}', replaceValue(values.count, '{{count}}'))
        .replace('{{message}}', replaceValue(values.message, '{{message}}')) };
});

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));

vi.mock('../../lib/notifyError', () => ({
    logError: vi.fn(),
}));

vi.mock('../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

function asRequest(input: FetchInput, init: RequestInit = {}): Request {
    if (input instanceof Request) return input;
    const target = typeof input === 'string' ? input : input.toString();
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

function installResolvedFetch(payload: unknown): MockedFunction<typeof fetch> {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload));
    globalThis.fetch = fetchMock;
    return fetchMock;
}

async function renderDialog(
    props: NotebookCreateDialogProps,
): Promise<HTMLDivElement> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    await act(async () => {
        root.render(<NotebookCreateDialog {...props} />);
        await Promise.resolve();
    });
    return container;
}

async function waitForCatalog(): Promise<void> {
    await act(async () => {
        await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 220);
        });
    });
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
    const button = [...container.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.includes(text));
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing button containing: ${text}`);
    }
    return button;
}

function findRequest(
    fetchMock: MockedFunction<typeof fetch>,
    method: string,
): Request {
    const request = fetchMock.mock.calls
        .map(([input, init]) => asRequest(input, init))
        .find((candidate) => candidate.method === method);
    if (!request) throw new Error(`Missing ${method} request`);
    return request;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

async function requestBody(request: Request): Promise<Readonly<Record<string, unknown>>> {
    const payload: unknown = await request.clone().json();
    if (!isRecord(payload)) throw new Error('Expected a JSON object request body');
    return payload;
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

describe('NotebookCreateDialog', () => {
    it('explains why Resources without attachment or URL sources are omitted', async () => {
        installResolvedFetch({
            items: [{ id: 'resource-1', title: 'Paper', source_count: 1 }],
            total: 1,
            page: 1,
            page_size: 50,
            hidden_without_sources: 3,
        });
        const container = await renderDialog({
            isOpen: true,
            onClose: vi.fn(),
            onCreated: vi.fn(),
        });
        await waitForCatalog();

        expect(container.textContent).toContain(
            '3 Resources are not shown because they have no attachments or URLs.',
        );
        expect(container.textContent).toContain('Paper');
    });

    it('exposes dialog semantics, closes with Escape, and does not close from the backdrop', async () => {
        installResolvedFetch({ items: [], total: 0, page: 1, page_size: 50 });
        const onClose = vi.fn<NonNullable<NotebookCreateDialogProps['onClose']>>();
        const container = await renderDialog({
            isOpen: true,
            onClose,
            onCreated: vi.fn(),
        });
        const dialog = container.querySelector('[role="dialog"]');
        if (!(dialog instanceof HTMLElement)) throw new Error('Missing dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-labelledby')).toBe('notebook-create-title');
        expect(document.activeElement).toBe(
            container.querySelector('input[data-autofocus]'),
        );

        const backdrop = container.querySelector('.notebook-modal-backdrop');
        if (!(backdrop instanceof HTMLElement)) throw new Error('Missing backdrop');
        act(() => {
            backdrop.click();
        });
        expect(onClose).not.toHaveBeenCalled();

        act(() => {
            dispatchWindowEvent(new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
            }));
        });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('creates a notebook from the exact selected Resource ids', async () => {
        const notebook = { id: 'notebook-1', title: 'Research' };
        const fetchMock = installFetchMock((input, init) => {
            const request = asRequest(input, init);
            if (request.method === 'POST') {
                return Promise.resolve(jsonResponse(notebook, 201));
            }
            return Promise.resolve(jsonResponse({
                items: [{ id: 'resource-1', title: 'Paper', source_count: 2 }],
                total: 1,
                page: 1,
                page_size: 50,
            }));
        });
        const onCreated = vi.fn<
            NonNullable<NotebookCreateDialogProps['onCreated']>
        >();
        const container = await renderDialog({
            isOpen: true,
            initialResourceIds: ['resource-1'],
            onClose: vi.fn(),
            onCreated,
        });
        await waitForCatalog();

        await act(async () => {
            findButton(container, 'Create notebook').click();
            await Promise.resolve();
            await Promise.resolve();
        });

        const request = findRequest(fetchMock, 'POST');
        expect(new URL(request.url).pathname).toBe('/api/notebooks');
        await expect(requestBody(request)).resolves.toMatchObject({
            resource_ids: ['resource-1'],
            visibility: 'private',
            conversation_mode: 'private_member',
        });
        expect(onCreated).toHaveBeenCalledWith(notebook);
    });

    it('keeps a manually selected Resource when no initial selection is provided', async () => {
        const fetchMock = installFetchMock((input, init) => {
            const request = asRequest(input, init);
            if (request.method === 'POST') {
                return Promise.resolve(jsonResponse({ id: 'notebook-2' }, 201));
            }
            return Promise.resolve(jsonResponse({
                items: [{
                    id: 'resource-2',
                    title: 'Manual selection',
                    source_count: 1,
                }],
                total: 1,
                page: 1,
                page_size: 50,
            }));
        });
        const container = await renderDialog({
            isOpen: true,
            onClose: vi.fn(),
            onCreated: vi.fn(),
        });
        await waitForCatalog();

        act(() => {
            findButton(container, 'Manual selection').click();
        });
        expect(container.textContent).toContain('1 Resources selected');

        await act(async () => {
            findButton(container, 'Create notebook').click();
            await Promise.resolve();
            await Promise.resolve();
        });
        await expect(requestBody(findRequest(fetchMock, 'POST'))).resolves.toMatchObject({
            resource_ids: ['resource-2'],
        });
    });

    it('keeps selections while paging through hundreds of Resources', async () => {
        const fetchMock = installFetchMock((input, init) => {
            const request = asRequest(input, init);
            if (request.method === 'POST') {
                return Promise.resolve(jsonResponse({ id: 'notebook-paged' }, 201));
            }
            const page = new URL(request.url).searchParams.get('page') === '2' ? 2 : 1;
            return Promise.resolve(jsonResponse({
                items: [{
                    id: page === 1 ? 'resource-1' : 'resource-51',
                    title: page === 1
                        ? 'First page Resource'
                        : 'Second page Resource',
                    source_count: 1,
                }],
                total: 51,
                page,
                page_size: 50,
            }));
        });
        const container = await renderDialog({
            isOpen: true,
            onClose: vi.fn(),
            onCreated: vi.fn(),
        });
        await waitForCatalog();

        act(() => {
            findButton(container, 'First page Resource').click();
        });
        const nextPage = container.querySelector(
            'nav[aria-label="Resource pages"] button:last-child',
        );
        if (!(nextPage instanceof HTMLButtonElement)) {
            throw new Error('Missing next-page button');
        }
        act(() => {
            nextPage.click();
        });
        await waitForCatalog();
        act(() => {
            findButton(container, 'Second page Resource').click();
        });
        await act(async () => {
            findButton(container, 'Create notebook').click();
            await Promise.resolve();
            await Promise.resolve();
        });

        const body = await requestBody(findRequest(fetchMock, 'POST'));
        if (!isStringArray(body.resource_ids)) {
            throw new Error('Expected notebook resource identifiers');
        }
        expect([...body.resource_ids].sort()).toEqual([
            'resource-1',
            'resource-51',
        ]);
    });

    it('requests the selected type, author, and tag filters from the shared catalog', async () => {
        const fetchMock = installFetchMock(() => Promise.resolve(jsonResponse({
            items: [],
            total: 0,
            page: 1,
            page_size: 50,
            facets: {
                types: [{ value: 'Course', count: 2 }],
                authors: [{ value: 'Ada Lovelace', count: 1 }],
                tags: [{ value: 'Education', count: 1 }],
            },
        })));
        const container = await renderDialog({
            isOpen: true,
            onClose: vi.fn(),
            onCreated: vi.fn(),
        });
        await waitForCatalog();

        const setFilter = async (label: string, value: string): Promise<void> => {
            const select = [...container.querySelectorAll('label')]
                .find((candidate) => candidate.textContent.includes(label))
                ?.querySelector('select');
            if (!(select instanceof HTMLSelectElement)) {
                throw new Error(`Missing ${label} filter`);
            }
            act(() => {
                select.value = value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            });
            await waitForCatalog();
        };

        await setFilter('Type', 'Course');
        await setFilter('Author', 'Ada Lovelace');
        await setFilter('Tag', 'Education');

        const urls = fetchMock.mock.calls
            .map(([input, init]) => new URL(asRequest(input, init).url));
        const filteredUrl = urls.at(-1);
        if (!filteredUrl) throw new Error('Missing filtered catalog request');
        expect(filteredUrl.searchParams.get('type')).toBe('Course');
        expect(filteredUrl.searchParams.get('author')).toBe('Ada Lovelace');
        expect(filteredUrl.searchParams.get('tag')).toBe('Education');
        expect(filteredUrl.searchParams.get('page')).toBe('1');
    });
});
