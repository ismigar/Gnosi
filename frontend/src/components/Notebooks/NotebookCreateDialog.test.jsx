import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import NotebookCreateDialog from './NotebookCreateDialog';

const { translate } = vi.hoisted(() => ({
    translate: (_key, fallback, values = {}) => String(fallback || _key)
        .replace('{{count}}', values.count ?? '{{count}}')
        .replace('{{message}}', values.message ?? '{{message}}'),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: translate,
    }),
}));

vi.mock('../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

const mountedRoots = [];

function asRequest(input, init = {}) {
    return input instanceof Request
        ? input
        : new Request(new URL(String(input), window.location.origin), init);
}

function jsonResponse(payload, status = 200) {
    return Response.json(payload, { status });
}

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    vi.restoreAllMocks();
    while (mountedRoots.length) {
        const { root, container } = mountedRoots.pop();
        await act(async () => root.unmount());
        container.remove();
    }
});

describe('NotebookCreateDialog', () => {
    it('explains why Resources without attachment or URL sources are omitted', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({
                items: [{ id: 'resource-1', title: 'Paper', source_count: 1 }],
                total: 1,
                page: 1,
                page_size: 50,
                hidden_without_sources: 3,
        }));
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });

        await act(async () => {
            root.render(<NotebookCreateDialog isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
        });
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 220));
        });

        expect(container.textContent).toContain(
            '3 Resources are not shown because they have no attachments or URLs.',
        );
        expect(container.textContent).toContain('Paper');
    });

    it('exposes dialog semantics, closes with Escape, and does not close from the backdrop', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
            jsonResponse({ items: [], total: 0, page: 1, page_size: 50 }),
        );
        const onClose = vi.fn();
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });

        await act(async () => {
            root.render(<NotebookCreateDialog isOpen onClose={onClose} onCreated={vi.fn()} />);
        });
        const dialog = container.querySelector('[role="dialog"]');
        expect(dialog).toBeTruthy();
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-labelledby')).toBe('notebook-create-title');
        expect(document.activeElement).toBe(container.querySelector('input[data-autofocus]'));

        await act(async () => container.querySelector('.notebook-modal-backdrop')
            .dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(onClose).not.toHaveBeenCalled();

        await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('creates a notebook from the exact selected Resource ids', async () => {
        const notebook = { id: 'notebook-1', title: 'Research' };
        globalThis.fetch = vi.fn().mockImplementation((input, init) => {
            const request = asRequest(input, init);
            if (request.method === 'POST') return Promise.resolve(jsonResponse(notebook, 201));
            return Promise.resolve(jsonResponse({
                    items: [{ id: 'resource-1', title: 'Paper', source_count: 2 }],
                    total: 1,
                    page: 1,
                    page_size: 50,
            }));
        });
        const onCreated = vi.fn();
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });

        await act(async () => {
            root.render(
                <NotebookCreateDialog
                    isOpen
                    initialResourceIds={['resource-1']}
                    onClose={vi.fn()}
                    onCreated={onCreated}
                />,
            );
        });
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 220));
        });

        const submit = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Create notebook'));
        expect(submit).toBeTruthy();
        await act(async () => {
            submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        });

        const request = globalThis.fetch.mock.calls
            .map(([input, init]) => asRequest(input, init))
            .find((candidate) => candidate.method === 'POST');
        expect(new URL(request.url).pathname).toBe('/api/notebooks');
        await expect(request.clone().json()).resolves.toMatchObject({
            resource_ids: ['resource-1'],
            visibility: 'private',
            conversation_mode: 'private_member',
        });
        expect(onCreated).toHaveBeenCalledWith(notebook);
    });

    it('keeps a manually selected Resource when no initial selection is provided', async () => {
        globalThis.fetch = vi.fn().mockImplementation((input, init) => {
            const request = asRequest(input, init);
            if (request.method === 'POST') {
                return Promise.resolve(jsonResponse({ id: 'notebook-2' }, 201));
            }
            return Promise.resolve(jsonResponse({
                    items: [{ id: 'resource-2', title: 'Manual selection', source_count: 1 }],
                    total: 1,
                    page: 1,
                    page_size: 50,
            }));
        });
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });

        await act(async () => {
            root.render(<NotebookCreateDialog isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
        });
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 220));
        });
        const resourceButton = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Manual selection'));
        await act(async () => {
            resourceButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(container.textContent).toContain('1 Resources selected');

        const submit = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Create notebook'));
        await act(async () => {
            submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        });
        const request = globalThis.fetch.mock.calls
            .map(([input, init]) => asRequest(input, init))
            .find((candidate) => candidate.method === 'POST');
        await expect(request.clone().json()).resolves.toMatchObject({
            resource_ids: ['resource-2'],
        });
    });

    it('keeps selections while paging through hundreds of Resources', async () => {
        globalThis.fetch = vi.fn().mockImplementation((input, init) => {
            const request = asRequest(input, init);
            if (request.method === 'POST') {
                return Promise.resolve(jsonResponse({ id: 'notebook-paged' }, 201));
            }
            const page = new URL(request.url).searchParams.get('page') === '2' ? 2 : 1;
            return Promise.resolve(jsonResponse({
                    items: [{
                        id: page === 1 ? 'resource-1' : 'resource-51',
                        title: page === 1 ? 'First page Resource' : 'Second page Resource',
                        source_count: 1,
                    }],
                    total: 51,
                    page,
                    page_size: 50,
            }));
        });
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });

        await act(async () => {
            root.render(<NotebookCreateDialog isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
        });
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 220));
        });
        const clickButtonContaining = async (text) => {
            const button = [...container.querySelectorAll('button')]
                .find((candidate) => candidate.textContent.includes(text));
            expect(button).toBeTruthy();
            await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        };
        await clickButtonContaining('First page Resource');
        const nextPage = container.querySelector('nav[aria-label="Resource pages"] button:last-child');
        await act(async () => {
            nextPage.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise((resolve) => window.setTimeout(resolve, 220));
        });
        await clickButtonContaining('Second page Resource');
        await clickButtonContaining('Create notebook');
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        const request = globalThis.fetch.mock.calls
            .map(([input, init]) => asRequest(input, init))
            .find((candidate) => candidate.method === 'POST');
        const body = await request.clone().json();
        expect(body.resource_ids.sort()).toEqual(['resource-1', 'resource-51']);
    });

    it('requests the selected type, author, and tag filters from the shared catalog', async () => {
        globalThis.fetch = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({
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
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });

        await act(async () => {
            root.render(<NotebookCreateDialog isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
        });
        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 220));
        });

        const setFilter = async (label, value) => {
            const select = [...container.querySelectorAll('label')]
                .find((candidate) => candidate.textContent.includes(label))
                ?.querySelector('select');
            expect(select).toBeTruthy();
            await act(async () => {
                select.value = value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                await new Promise((resolve) => window.setTimeout(resolve, 220));
            });
        };

        await setFilter('Type', 'Course');
        await setFilter('Author', 'Ada Lovelace');
        await setFilter('Tag', 'Education');

        const urls = globalThis.fetch.mock.calls
            .map(([input, init]) => new URL(asRequest(input, init).url));
        const filtered = urls.at(-1).searchParams;
        expect(filtered.get('type')).toBe('Course');
        expect(filtered.get('author')).toBe('Ada Lovelace');
        expect(filtered.get('tag')).toBe('Education');
        expect(filtered.get('page')).toBe('1');
    });
});
