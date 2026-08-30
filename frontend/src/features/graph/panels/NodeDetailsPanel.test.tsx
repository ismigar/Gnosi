import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { VaultPage } from '../../../shared/api/vaults';
import { NodeDetailsPanel } from './NodeDetailsPanel';

const mocks = vi.hoisted(() => ({
    fetchVaultPage: vi.fn(),
    logError: vi.fn(),
    translate: (_key: string, fallback?: string) => fallback ?? _key,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: mocks.translate,
    }),
}));

vi.mock('../../../shared/api/vaults', () => ({
    fetchVaultPage: mocks.fetchVaultPage,
}));

vi.mock('../../../lib/notifyError', () => ({
    logError: mocks.logError,
}));

vi.mock('../../../components/Vault/VaultMarkdown', () => ({
    VaultMarkdown: ({ md }: { readonly md: string }) => (
        <div data-testid="vault-markdown">{md}</div>
    ),
}));

interface MountedPanel {
    readonly container: HTMLDivElement;
    readonly root: Root;
}

const mountedPanels: MountedPanel[] = [];
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};

beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    while (mountedPanels.length > 0) {
        const mounted = mountedPanels.pop();
        if (!mounted) break;
        act(() => {
            mounted.root.unmount();
        });
        mounted.container.remove();
    }
    mocks.fetchVaultPage.mockReset();
    mocks.logError.mockReset();
});

async function mountPanel(
    props: Partial<React.ComponentProps<typeof NodeDetailsPanel>> = {},
): Promise<HTMLDivElement> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedPanels.push({ container, root });

    await act(async () => {
        root.render(
            <NodeDetailsPanel
                nodeId="page-1"
                isOpen
                onClose={() => undefined}
                {...props}
            />,
        );
        await Promise.resolve();
    });

    return container;
}

function page(overrides: Partial<VaultPage> = {}): VaultPage {
    return {
        content: '# Loaded body',
        etag: 'etag-1',
        folder: '',
        id: 'page-1',
        metadata: {},
        title: 'Loaded title',
        ...overrides,
    };
}

describe('NodeDetailsPanel', () => {
    it('shows graph metadata immediately and merges the typed Vault page', async () => {
        mocks.fetchVaultPage.mockResolvedValue(page());
        const onClose = vi.fn();
        const container = await mountPanel({
            initialData: {
                label: 'Graph title',
                tags: ['research', { name: 'draft' }],
                url: 'https://example.test/preview.png',
            },
            onClose,
        });

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.fetchVaultPage).toHaveBeenCalledWith(
            'page-1',
            expect.any(AbortSignal),
        );
        expect(container.querySelector('h2')?.textContent).toBe('Loaded title');
        expect(container.textContent).toContain('#research');
        expect(container.textContent).toContain('#draft');
        expect(container.querySelector('[data-testid="vault-markdown"]')?.textContent)
            .toBe('# Loaded body');
        expect(container.querySelector('img')?.getAttribute('src'))
            .toBe('https://example.test/preview.png');

        act(() => {
            container.querySelector('button')?.click();
        });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('reports a failed request and keeps initial graph data visible', async () => {
        const failure = new Error('offline');
        mocks.fetchVaultPage.mockRejectedValue(failure);
        const container = await mountPanel({ initialData: { label: 'Cached title' } });

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(container.querySelector('h2')?.textContent).toBe('Cached title');
        expect(container.textContent).toContain('No content...');
        expect(mocks.logError).toHaveBeenCalledWith('graph-node-details', failure);
    });
});
