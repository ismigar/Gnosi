import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import AgentContextSources from './AgentContextSources';
import type { ContextReference } from './agent-context/agentContextModel';


const { fetchInternalContextSources } = vi.hoisted(() => ({
    fetchInternalContextSources: vi.fn(),
}));


vi.mock('../shared/api/agent-context', () => ({
    fetchExternalContextSources: vi.fn(),
    fetchInternalContextSources,
}));


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (
            key: string,
            fallback?: string | { defaultValue?: string },
            values: Readonly<Record<string, unknown>> = {},
        ) => {
            const template = typeof fallback === 'string'
                ? fallback
                : fallback?.defaultValue ?? key;
            return Object.entries(values).reduce(
                (text, [name, value]) => text.replace(
                    `{{${name}}}`,
                    String(value),
                ),
                template,
            );
        },
    }),
}));


const { toastMock } = vi.hoisted(() => ({
    toastMock: Object.assign(vi.fn(), { error: vi.fn() }),
}));
vi.mock('../lib/toast', () => ({ toast: toastMock }));


const sourceCatalogue = [{
    description: 'Reader context',
    id: 'reader',
    name: 'Reader',
    options: {
        categories: ['Politics'],
        sources: [{ category: 'Politics', id: 7, name: 'Policy feed' }],
    },
    scope: {
        categories: [],
        date_from: '',
        date_to: '',
        include_full_content: false,
        source_ids: [],
        unread_only: true,
    },
}, {
    description: 'Planning context',
    id: 'planning',
    name: 'Planning',
    options: {
        entity_types: ['project', 'task', 'resource'],
        projects: [{ id: 'p1', name: 'Launch' }],
        resources: [{ id: 'r1', name: 'Ada' }],
    },
    scope: {
        entity_types: [],
        include_inactive: false,
        project_ids: [],
        resource_ids: [],
    },
}, {
    description: 'Notion context',
    id: 'notion',
    name: 'Notion',
    options: {
        databases: [{ id: 'db1', name: 'Research' }],
        object_types: ['database', 'page'],
    },
    scope: { database_ids: [], object_types: [] },
}];


interface MountedRoot {
    readonly container: HTMLDivElement;
    readonly root: Root;
}


const mountedRoots: MountedRoot[] = [];


const render = async (element: ReactElement): Promise<HTMLDivElement> => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });
    await act(async () => {
        root.render(element);
        await Promise.resolve();
    });
    return container;
};


const buttonByText = (container: HTMLElement, text: string): HTMLButtonElement => {
    const button = [...container.querySelectorAll('button')]
        .find((item) => item.textContent.includes(text));
    if (!button) throw new Error(`Button not rendered: ${text}`);
    return button;
};


const requiredButton = (
    container: ParentNode,
    selector: string,
): HTMLButtonElement => {
    const element = container.querySelector<HTMLButtonElement>(selector);
    if (!element) throw new Error(`Element not rendered: ${selector}`);
    return element;
};


const requiredInput = (
    container: ParentNode,
    selector: string,
): HTMLInputElement => {
    const element = container.querySelector<HTMLInputElement>(selector);
    if (!element) throw new Error(`Element not rendered: ${selector}`);
    return element;
};


beforeAll(() => {
    const reactTestEnvironment = globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
    };
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});


afterEach(() => {
    vi.clearAllMocks();
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) continue;
        act(() => {
            mounted.root.unmount();
        });
        mounted.container.remove();
    }
});


describe('AgentContextSources internal sources', () => {
    it('adds a source reference with its server-provided default scope', async () => {
        fetchInternalContextSources.mockResolvedValue(sourceCatalogue);
        const onChange = vi.fn<(references: ContextReference[]) => void>();
        const container = await render(
            <AgentContextSources onChange={onChange} value={[]} />,
        );

        await act(async () => {
            buttonByText(container, 'Gnosi source').dispatchEvent(
                new MouseEvent('click', { bubbles: true }),
            );
            await Promise.resolve();
        });
        act(() => {
            buttonByText(container, 'Reader').dispatchEvent(
                new MouseEvent('click', { bubbles: true }),
            );
        });

        const references = onChange.mock.calls[0]?.[0];
        expect(references).toHaveLength(1);
        expect(references?.[0]).toMatchObject({
            label: 'Reader',
            ref: 'reader',
            scope: { source_ids: [], unread_only: true },
            type: 'internal',
        });
    });

    it('edits a persisted Reader scope without granting actions', async () => {
        fetchInternalContextSources.mockResolvedValue(sourceCatalogue);
        const onChange = vi.fn<(references: ContextReference[]) => void>();
        const value: ContextReference[] = [{
            id: 'ctx-reader',
            label: 'Reader',
            ref: 'reader',
            scope: { source_ids: [], unread_only: true },
            type: 'internal',
        }];
        const container = await render(
            <AgentContextSources onChange={onChange} value={value} />,
        );

        act(() => {
            requiredButton(
                container,
                'button[aria-label="Configure source scope"]',
            ).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        act(() => {
            requiredInput(
                container,
                'input[type="checkbox"]',
            ).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(container.textContent).toContain('Actions are governed separately.');
        expect(container.querySelectorAll('input[type="date"]')).toHaveLength(2);
        const updated = onChange.mock.calls[0]?.[0]?.[0];
        expect(updated?.id).toBe('ctx-reader');
        expect(updated?.scope).toMatchObject({ unread_only: false });
    });

    it('renders server-provided Planning scope options', async () => {
        fetchInternalContextSources.mockResolvedValue(sourceCatalogue);
        const value: ContextReference[] = [{
            id: 'ctx-planning',
            label: 'Planning',
            ref: 'planning',
            scope: { entity_types: [], project_ids: [], resource_ids: [] },
            type: 'internal',
        }];
        const container = await render(
            <AgentContextSources onChange={vi.fn()} value={value} />,
        );
        act(() => {
            requiredButton(
                container,
                'button[aria-label="Configure source scope"]',
            ).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(container.textContent).toContain('Planning entities');
        expect(container.textContent).toContain('Launch');
        expect(container.textContent).toContain('Ada');
        expect(container.querySelectorAll('select[multiple]')).toHaveLength(3);
    });

    it('renders connected Notion scope options', async () => {
        fetchInternalContextSources.mockResolvedValue(sourceCatalogue);
        const value: ContextReference[] = [{
            id: 'ctx-notion',
            label: 'Notion',
            ref: 'notion',
            scope: { database_ids: [], object_types: [] },
            type: 'internal',
        }];
        const container = await render(
            <AgentContextSources onChange={vi.fn()} value={value} />,
        );
        act(() => {
            requiredButton(
                container,
                'button[aria-label="Configure source scope"]',
            ).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(container.textContent).toContain('Object types');
        expect(container.textContent).toContain('Research');
        expect(container.querySelectorAll('select[multiple]')).toHaveLength(2);
    });
});
