import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { NotebookDetail } from './NotebooksPage';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key, fallback, values = {}) => String(fallback || _key)
            .replace('{{revision}}', values.revision ?? '{{revision}}')
            .replace('{{resources}}', values.resources ?? '{{resources}}')
            .replace('{{sources}}', values.sources ?? '{{sources}}')
            .replace('{{resource}}', values.resource ?? '{{resource}}')
            .replace('{{time}}', values.time ?? '{{time}}'),
    }),
}));

vi.mock('../components/AgentChat', () => ({
    default: ({ readOnly }) => (
        <div data-testid="agent-chat" data-read-only={String(readOnly)}>
            {readOnly ? 'Read-only conversation' : 'Editable conversation'}
        </div>
    ),
}));

vi.mock('../components/ConfirmModal', () => ({ default: () => null }));
vi.mock('../lib/toast', () => ({
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
        globalThis.fetch = vi.fn().mockImplementation((url) => Promise.resolve({
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue(String(url).includes('/sources?')
                ? { items: [], total: 0, page: 1, page_size: 50, active_revision: 1 }
                : notebook),
        }));
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });

        await act(async () => {
            root.render(
                <MemoryRouter>
                    <NotebookDetail notebookId="notebook-1" />
                </MemoryRouter>,
            );
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(container.querySelector('[data-testid="agent-chat"]')?.dataset.readOnly).toBe('true');
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
        globalThis.fetch = vi.fn().mockImplementation((url, options = {}) => Promise.resolve({
            ok: true,
            status: options.method === 'POST' ? 202 : 200,
            json: vi.fn().mockResolvedValue(String(url).includes('/sources?') ? sourceData : notebook),
        }));
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });

        await act(async () => {
            root.render(<MemoryRouter><NotebookDetail notebookId="notebook-1" /></MemoryRouter>);
            await Promise.resolve();
            await Promise.resolve();
        });
        const retry = container.querySelector('button[aria-label="Retry Resource"]');
        expect(retry).toBeTruthy();
        await act(async () => {
            retry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(globalThis.fetch).toHaveBeenCalledWith(
            '/api/notebooks/notebook-1/sources/resource-1/refresh',
            expect.objectContaining({ method: 'POST' }),
        );
        expect(globalThis.fetch.mock.calls.some(([url, options]) => (
            url === '/api/notebooks/notebook-1/refresh' && options?.method === 'POST'
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
        globalThis.fetch = vi.fn().mockImplementation((url) => Promise.resolve({
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue(String(url).includes('/sources?')
                ? { items: [], total: 0, page: 1, page_size: 50, active_revision: 1 }
                : notebook),
        }));
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedRoots.push({ root, container });

        await act(async () => {
            root.render(<MemoryRouter><NotebookDetail notebookId="notebook-1" /></MemoryRouter>);
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(container.textContent).toContain('Current Resource: Lecture recording');
        const cancel = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Cancel indexing'));
        expect(cancel).toBeTruthy();
        await act(async () => {
            cancel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(globalThis.fetch).toHaveBeenCalledWith(
            '/api/notebooks/notebook-1/refresh/cancel',
            { method: 'POST' },
        );
    });
});
