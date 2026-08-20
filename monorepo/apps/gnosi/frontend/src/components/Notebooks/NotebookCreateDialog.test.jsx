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
    it('creates a notebook from the exact selected Resource ids', async () => {
        const notebook = { id: 'notebook-1', title: 'Research' };
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue({
                    items: [{ id: 'resource-1', title: 'Paper', source_count: 2 }],
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue(notebook),
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

        const request = globalThis.fetch.mock.calls.find(([, options]) => options?.method === 'POST');
        expect(request[0]).toBe('/api/notebooks');
        expect(JSON.parse(request[1].body)).toMatchObject({
            resource_ids: ['resource-1'],
            visibility: 'private',
            conversation_mode: 'private_member',
        });
        expect(onCreated).toHaveBeenCalledWith(notebook);
    });

    it('keeps a manually selected Resource when no initial selection is provided', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue({
                    items: [{ id: 'resource-2', title: 'Manual selection', source_count: 1 }],
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue({ id: 'notebook-2' }),
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
        const request = globalThis.fetch.mock.calls.find(([, options]) => options?.method === 'POST');
        expect(JSON.parse(request[1].body).resource_ids).toEqual(['resource-2']);
    });

    it('keeps selections while paging through hundreds of Resources', async () => {
        globalThis.fetch = vi.fn().mockImplementation((url, options) => {
            if (options?.method === 'POST') {
                return Promise.resolve({
                    ok: true,
                    json: vi.fn().mockResolvedValue({ id: 'notebook-paged' }),
                });
            }
            const page = String(url).includes('page=2') ? 2 : 1;
            return Promise.resolve({
                ok: true,
                json: vi.fn().mockResolvedValue({
                    items: [{
                        id: page === 1 ? 'resource-1' : 'resource-51',
                        title: page === 1 ? 'First page Resource' : 'Second page Resource',
                        source_count: 1,
                    }],
                    total: 51,
                    page,
                    page_size: 50,
                }),
            });
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

        const request = globalThis.fetch.mock.calls.find(([, options]) => options?.method === 'POST');
        expect(JSON.parse(request[1].body).resource_ids.sort()).toEqual(['resource-1', 'resource-51']);
    });
});
