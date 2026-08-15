import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ContextualLinkPasteMenu from './ContextualLinkPasteMenu';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key, options) => options?.defaultValue || _key,
    }),
}));

let root = null;
let container = null;

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

async function renderMenu(props = {}) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root.render(
            <ContextualLinkPasteMenu
                position={{ left: 40, top: 50 }}
                onChoose={() => {}}
                onClose={() => {}}
                {...props}
            />,
        );
    });
    return container;
}

afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
    root = null;
    container = null;
});

describe('ContextualLinkPasteMenu', () => {
    it('moves focus with arrow keys and applies the focused choice', async () => {
        const onChoose = vi.fn();
        await renderMenu({ onChoose });
        const items = [...container.querySelectorAll('[role="menuitem"]')];
        expect(document.activeElement).toBe(items[0]);

        await act(async () => {
            items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        });
        expect(document.activeElement).toBe(items[1]);

        await act(async () => items[1].click());
        expect(onChoose).toHaveBeenCalledWith('embed');
    });

    it('closes on Escape and on an outside pointer press', async () => {
        const onClose = vi.fn();
        await renderMenu({ onClose });
        const first = container.querySelector('[role="menuitem"]');

        await act(async () => {
            first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(onClose).toHaveBeenCalledTimes(1);

        await act(async () => {
            document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        });
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});
