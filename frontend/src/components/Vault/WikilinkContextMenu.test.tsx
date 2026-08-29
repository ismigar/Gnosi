import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { WikilinkContextMenu } from './WikilinkContextMenu';


const translate = (key: string, fallback?: string): string => fallback ?? key;


vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
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


async function waitForListeners(): Promise<void> {
    await act(async () => {
        await new Promise((resolve) => { window.setTimeout(resolve, 0); });
    });
}


describe('WikilinkContextMenu', () => {
    it('does not render while closed or without a position', () => {
        render(<WikilinkContextMenu isOpen={false} onClose={vi.fn()} position={null} />);
        expect(document.body.querySelector('[role="menu"]')).toBeNull();
    });

    it('runs an enabled mouse action and closes the menu', () => {
        const onClose = vi.fn();
        const onOpenSameTab = vi.fn();
        render(<WikilinkContextMenu
            isOpen
            onClose={onClose}
            onOpenSameTab={onOpenSameTab}
            position={{ x: 10, y: 20 }}
        />);

        const openHere = [...document.body.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Open here'));
        act(() => { openHere?.click(); });

        expect(onOpenSameTab).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('disables unavailable actions', () => {
        render(<WikilinkContextMenu
            isOpen
            onClose={vi.fn()}
            onOpenSameTab={vi.fn()}
            position={{ x: 10, y: 20 }}
        />);

        const buttons = document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
        expect(buttons[0]?.disabled).toBe(false);
        expect(buttons[1]?.disabled).toBe(true);
        expect(buttons[2]?.disabled).toBe(true);
    });

    it('selects and activates the first enabled action from the keyboard', async () => {
        const onClose = vi.fn();
        const onOpenSameTab = vi.fn();
        render(<WikilinkContextMenu
            isOpen
            onClose={onClose}
            onOpenSameTab={onOpenSameTab}
            position={{ x: 10, y: 20 }}
        />);
        await waitForListeners();

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                key: 'ArrowDown',
            }));
            document.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                key: 'Enter',
            }));
        });

        expect(onOpenSameTab).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });
});
