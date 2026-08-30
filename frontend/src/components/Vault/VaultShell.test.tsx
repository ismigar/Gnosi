import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchWindowEvent } from '../../shared/platform/browser-events';
import { VaultShell } from './VaultShell';


const mediaQueryState = vi.hoisted(() => new Map<string, boolean>());
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string | { readonly defaultValue?: string }) => (
            typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key
        ),
    }),
}));

vi.mock('../../shared/hooks/useMediaQuery', () => ({
    useMediaQuery: (query: string) => mediaQueryState.get(query) ?? false,
}));


interface RenderOptions {
    readonly children?: ReactNode;
    readonly onBack?: () => void;
    readonly onCloseDocument?: () => void;
    readonly onForward?: () => void;
    readonly onNewDocument?: () => void;
    readonly onSearch?: () => void;
}


describe('VaultShell', () => {
    let container: HTMLDivElement;
    let root: Root;

    const renderShell = (options: RenderOptions = {}) => {
        act(() => {
            root.render(
                <VaultShell
                    breadcrumbs={[{ label: 'Knowledge', onClick: vi.fn() }]}
                    canGoBack
                    canGoForward
                    onBack={options.onBack ?? vi.fn()}
                    onCloseDocument={options.onCloseDocument ?? vi.fn()}
                    onForward={options.onForward ?? vi.fn()}
                    onNewDocument={options.onNewDocument ?? vi.fn()}
                    onSearch={options.onSearch ?? vi.fn()}
                    showDocumentControls
                    sidebarContent={<nav>Vault navigation</nav>}
                >
                    {options.children ?? <main>Current document</main>}
                </VaultShell>,
            );
        });
    };

    const buttonByLabel = (label: string): HTMLButtonElement => {
        const button = container.querySelector<HTMLButtonElement>(
            `button[aria-label="${label}"]`,
        );
        if (!button) throw new Error(`Button missing: ${label}`);
        return button;
    };

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        mediaQueryState.clear();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
        vi.clearAllMocks();
    });

    it('renders shell content and delegates every visible navigation action', () => {
        const onBack = vi.fn();
        const onCloseDocument = vi.fn();
        const onForward = vi.fn();
        const onNewDocument = vi.fn();
        const onSearch = vi.fn();
        renderShell({
            onBack,
            onCloseDocument,
            onForward,
            onNewDocument,
            onSearch,
        });

        expect(container.textContent).toContain('Vault navigation');
        expect(container.textContent).toContain('Knowledge');
        expect(container.textContent).toContain('Current document');

        act(() => { buttonByLabel('shell.go_back').click(); });
        act(() => { buttonByLabel('shell.go_forward').click(); });
        act(() => { buttonByLabel('Quick search').click(); });
        act(() => { buttonByLabel('Close tab').click(); });
        const newDocumentButton = Array.from(container.querySelectorAll('button'))
            .find((button) => button.title.startsWith('New tab or quick search'));
        if (!newDocumentButton) throw new Error('New-document button missing');
        act(() => { newDocumentButton.click(); });

        expect(onBack).toHaveBeenCalledOnce();
        expect(onForward).toHaveBeenCalledOnce();
        expect(onSearch).toHaveBeenCalledOnce();
        expect(onCloseDocument).toHaveBeenCalledOnce();
        expect(onNewDocument).toHaveBeenCalledOnce();
    });

    it('opens the narrow sidebar as a drawer and closes it with Escape', () => {
        mediaQueryState.set('(max-width: 1023px)', true);
        renderShell();

        const sidebar = container.querySelector<HTMLElement>('#vault-navigation');
        if (!sidebar) throw new Error('Sidebar missing');
        expect(sidebar.classList.contains('is-open')).toBe(false);
        expect(container.querySelector('.vault-shell__backdrop')).toBeNull();

        act(() => { buttonByLabel('Show sidebar').click(); });
        expect(sidebar.classList.contains('is-open')).toBe(true);
        expect(container.querySelector('.vault-shell__backdrop')).not.toBeNull();

        act(() => {
            dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        });
        expect(sidebar.classList.contains('is-open')).toBe(false);
        expect(container.querySelector('.vault-shell__backdrop')).toBeNull();
    });

    it('hides breadcrumbs in compact mode', () => {
        mediaQueryState.set('(max-width: 768px)', true);
        mediaQueryState.set('(max-width: 1023px)', true);
        renderShell();

        expect(container.textContent).not.toContain('Knowledge');
    });
});
