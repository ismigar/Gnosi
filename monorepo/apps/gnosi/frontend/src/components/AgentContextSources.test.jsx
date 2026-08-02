import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import axios from 'axios';
import AgentContextSources from './AgentContextSources';

vi.mock('axios', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
    },
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key, fallback, values = {}) => {
            const template = typeof fallback === 'string'
                ? fallback
                : fallback?.defaultValue || _key;
            return Object.entries(values).reduce(
                (text, [name, value]) => text.replace(`{{${name}}}`, value),
                template,
            );
        },
    }),
}));

const { toastMock } = vi.hoisted(() => {
    const mock = vi.fn();
    mock.error = vi.fn();
    return { toastMock: mock };
});
vi.mock('../lib/toast', () => ({ toast: toastMock }));

const sourceCatalogue = [{
    id: 'reader',
    name: 'Reader',
    scope: {
        unread_only: true,
        source_ids: [],
        categories: [],
        date_from: '',
        date_to: '',
        include_full_content: false,
    },
    options: {
        sources: [{ id: 7, name: 'Policy feed', category: 'Politics' }],
        categories: ['Politics'],
    },
}];

const mountedRoots = [];

const render = async element => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    await act(async () => root.render(element));
    return container;
};

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    vi.clearAllMocks();
    while (mountedRoots.length > 0) {
        const { root, container } = mountedRoots.pop();
        await act(async () => root.unmount());
        container.remove();
    }
});

describe('AgentContextSources internal sources', () => {
    it('adds a source reference with its server-provided default scope', async () => {
        axios.get.mockResolvedValue({ data: sourceCatalogue });
        const onChange = vi.fn();
        const container = await render(<AgentContextSources value={[]} onChange={onChange} />);

        const addSource = [...container.querySelectorAll('button')]
            .find(button => button.textContent.includes('Gnosi source'));
        await act(async () => addSource.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        await act(async () => Promise.resolve());
        const reader = [...container.querySelectorAll('button')]
            .find(button => button.textContent.trim().endsWith('Reader'));
        await act(async () => reader.dispatchEvent(new MouseEvent('click', { bubbles: true })));

        const refs = onChange.mock.calls[0][0];
        expect(refs).toHaveLength(1);
        expect(refs[0]).toMatchObject({
            type: 'internal',
            ref: 'reader',
            label: 'Reader',
            scope: { unread_only: true, source_ids: [] },
        });
    });

    it('edits a persisted Reader scope without granting actions', async () => {
        axios.get.mockResolvedValue({ data: sourceCatalogue });
        const onChange = vi.fn();
        const value = [{
            id: 'ctx-reader',
            type: 'internal',
            ref: 'reader',
            label: 'Reader',
            scope: { unread_only: true, source_ids: [] },
        }];
        const container = await render(<AgentContextSources value={value} onChange={onChange} />);
        await act(async () => Promise.resolve());

        const configure = container.querySelector('button[aria-label="Configure source scope"]');
        await act(async () => configure.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        const unread = container.querySelector('input[type="checkbox"]');
        await act(async () => unread.dispatchEvent(new MouseEvent('click', { bubbles: true })));

        expect(container.textContent).toContain('Actions are governed separately.');
        expect(container.querySelectorAll('input[type="date"]')).toHaveLength(2);
        expect(onChange).toHaveBeenCalledWith([expect.objectContaining({
            id: 'ctx-reader',
            scope: expect.objectContaining({ unread_only: false }),
        })]);
    });
});
