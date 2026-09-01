import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { PageActionsBar } from './PageActionsBar';


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback ?? key,
    }),
}));


vi.mock('../../../shared/hooks/useMediaQuery', () => ({
    useMediaQuery: () => false,
}));


vi.mock('../../../shared/hooks/useModalKeyboard', () => ({
    useModalKeyboard: () => undefined,
}));


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];


beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});


afterEach(() => {
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) continue;
        act(() => { mounted.root.unmount(); });
        mounted.container.remove();
    }
    vi.clearAllMocks();
});


function render(element: ReactElement): void {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });
    act(() => { root.render(element); });
}


describe('PageActionsBar', () => {
    it('runs primary actions from their inline buttons', () => {
        const onFavorite = vi.fn();
        const onComments = vi.fn();
        render(<PageActionsBar
            containerWidth={1200}
            pageActions={{
                canFavorite: true,
                canOpenComments: true,
                onOpenComments: onComments,
                onToggleFavorite: onFavorite,
            }}
        />);

        act(() => {
            document.body.querySelector<HTMLButtonElement>('[aria-label="Add to favorites"]')?.click();
            document.body.querySelector<HTMLButtonElement>('[aria-label="Comments"]')?.click();
        });

        expect(onFavorite).toHaveBeenCalledOnce();
        expect(onComments).toHaveBeenCalledOnce();
    });

    it('opens overflow actions in a portal and closes after selection', () => {
        const onDelete = vi.fn();
        render(<PageActionsBar
            containerWidth={1200}
            pageActions={{
                canDeleteCurrentPage: true,
                canFavorite: true,
                onDeleteCurrentPage: onDelete,
            }}
        />);

        act(() => {
            document.body.querySelector<HTMLButtonElement>('[aria-label="Page options"]')?.click();
        });
        const menuItem = document.body.querySelector<HTMLButtonElement>('[role="menuitem"]');
        expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
        expect(menuItem?.textContent).toContain('shell.delete_current_page');

        act(() => { menuItem?.click(); });
        expect(onDelete).toHaveBeenCalledOnce();
        expect(document.body.querySelector('[role="menu"]')).toBeNull();
    });

    it('closes the portal when the user clicks outside', () => {
        render(<PageActionsBar
            containerWidth={1200}
            pageActions={{ canDeleteCurrentPage: true, canFavorite: true }}
        />);

        act(() => {
            document.body.querySelector<HTMLButtonElement>('[aria-label="Page options"]')?.click();
        });
        expect(document.body.querySelector('[role="menu"]')).not.toBeNull();

        act(() => {
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        expect(document.body.querySelector('[role="menu"]')).toBeNull();
    });
});
