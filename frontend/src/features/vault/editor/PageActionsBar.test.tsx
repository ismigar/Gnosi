import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Zap } from 'lucide-react';
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
            document.body.querySelector<HTMLButtonElement>('[aria-label="Add to bookmarks"]')?.click();
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
    it('keeps left-side row overflow inside the viewport and preserves disabled labels', () => {
        render(<PageActionsBar compactHeader compactOverflowItems={[{ key: 'disabled', Icon: Zap, label: 'Publish', disabled: true, disabledReason: 'Needs review' }]} />);
        const trigger = document.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
        if (!trigger) throw new Error('Missing trigger');
        vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ right: 100, bottom: 40 } as DOMRect);
        act(() => { trigger.click(); });
        const menu = document.querySelector<HTMLElement>('[role="menu"]');
        expect(window.innerWidth - Number.parseFloat(menu?.style.right || '0') - 224).toBeGreaterThanOrEqual(8);
        const item = menu?.querySelector<HTMLButtonElement>('button');
        expect(item?.disabled).toBe(true);
        expect(item?.textContent).toBe('Publish');
        expect(item?.title).toBe('Needs review');
    });

    it('opens bottom-row actions above the trigger when there is no space below', () => {
        render(<PageActionsBar compactHeader compactOverflowItems={[{ key: 'action', Icon: Zap, label: 'Review' }]} />);
        const trigger = document.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
        if (!trigger) throw new Error('Missing trigger');
        const top = window.innerHeight - 32;
        vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ right: 100, top, bottom: top + 24 } as DOMRect);
        act(() => { trigger.click(); });
        const menu = document.querySelector<HTMLElement>('[role="menu"]');
        expect(Number.parseFloat(menu?.style.top || '0') + 50).toBeLessThan(top);
    });

});
