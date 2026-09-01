import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ContextualLinkPasteMenu, {
    type ContextualLinkPasteMenuProps,
    type ContextualLinkPasteMode,
} from './ContextualLinkPasteMenu';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { defaultValue?: string }): string => (
            options?.defaultValue || key
        ),
    }),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

function renderMenu(props: Partial<ContextualLinkPasteMenuProps> = {}): HTMLDivElement {
    const nextContainer = document.createElement('div');
    document.body.appendChild(nextContainer);
    container = nextContainer;
    const nextRoot = createRoot(nextContainer);
    root = nextRoot;
    act(() => {
        nextRoot.render(
            <ContextualLinkPasteMenu
                position={{ left: 40, top: 50 }}
                {...props}
            />,
        );
    });
    return nextContainer;
}

afterEach(() => {
    const mountedRoot = root;
    if (mountedRoot) {
        act(() => {
            mountedRoot.unmount();
        });
    }
    container?.remove();
    root = null;
    container = null;
});

describe('ContextualLinkPasteMenu', () => {
    it('moves focus with arrow keys and applies the focused choice', () => {
        const onChoose = vi.fn<(mode: ContextualLinkPasteMode) => void>();
        const rendered = renderMenu({ onChoose });
        const items = [...rendered.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
        const firstItem = items.at(0);
        const secondItem = items.at(1);
        if (!firstItem || !secondItem) throw new Error('Expected menu items');
        expect(document.activeElement).toBe(firstItem);

        act(() => {
            firstItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        });
        expect(document.activeElement).toBe(secondItem);

        act(() => {
            secondItem.click();
        });
        expect(onChoose).toHaveBeenCalledWith('embed');
    });

    it('closes on Escape and on an outside pointer press', () => {
        const onClose = vi.fn<() => void>();
        const rendered = renderMenu({ onClose });
        const first = rendered.querySelector('[role="menuitem"]');
        if (!(first instanceof HTMLButtonElement)) throw new Error('Expected first menu item');

        act(() => {
            first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(onClose).toHaveBeenCalledTimes(1);

        act(() => {
            document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        });
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});
