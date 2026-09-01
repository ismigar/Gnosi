import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CanvasPageContext } from './context';
import { PageCardComponent } from './PageCardComponent';


const mocks = vi.hoisted(() => ({
    fetchVaultPage: vi.fn(),
}));
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback ?? key,
    }),
}));

vi.mock('tldraw', () => ({
    HTMLContainer: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../../shared/api/vaults', () => ({
    fetchVaultPage: mocks.fetchVaultPage,
}));


describe('PageCardComponent', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        mocks.fetchVaultPage.mockResolvedValue({
            content: '---\ntitle: Stored\n---\nLive content',
            title: 'Updated page',
        });
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        vi.clearAllMocks();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('loads live page data and delegates opening the page', async () => {
        const onOpenPage = vi.fn();
        await act(async () => {
            root.render(
                <CanvasPageContext.Provider value={{ onOpenPage }}>
                    <PageCardComponent shape={{
                        props: { h: 170, pageId: 'page-1', pageTitle: 'Cached', w: 260 },
                    }} />
                </CanvasPageContext.Provider>,
            );
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.fetchVaultPage).toHaveBeenCalledWith('page-1', expect.any(AbortSignal));
        expect(container.textContent).toContain('Updated page');
        expect(container.textContent).toContain('Live content');
        expect(container.textContent).not.toContain('title: Stored');
        const open = container.querySelector('button');
        if (!open) throw new Error('Open-page action did not render');
        act(() => {
            open.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        });
        expect(onOpenPage).toHaveBeenCalledWith('page-1');
    });
});
