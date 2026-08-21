import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { useModalKeyboard } from './useModalKeyboard';

let root;
let container;

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
    root = null;
    container = null;
});

function Dialog({ open, onClose, label = 'Test dialog' }) {
    const dialogRef = useRef(null);
    useModalKeyboard({
        isOpen: open,
        onClose,
        containerRef: dialogRef,
        trapFocus: true,
    });
    if (!open) return null;
    return (
        <section ref={dialogRef} role="dialog" aria-modal="true" aria-label={label}>
            <button type="button" data-autofocus>First</button>
            <button type="button">Last</button>
        </section>
    );
}

function NestedDialogs({ parentOpen, childOpen, onParentClose, onChildClose }) {
    const parentRef = useRef(null);
    const childRef = useRef(null);
    useModalKeyboard({
        isOpen: parentOpen,
        onClose: onParentClose,
        containerRef: parentRef,
        trapFocus: true,
    });
    useModalKeyboard({
        isOpen: childOpen,
        onClose: onChildClose,
        containerRef: childRef,
        trapFocus: true,
    });
    return (
        <>
            {parentOpen && <section ref={parentRef} role="dialog" aria-modal="true" aria-label="Parent"><button type="button">Parent action</button></section>}
            {childOpen && <section ref={childRef} role="dialog" aria-modal="true" aria-label="Child"><button type="button" data-autofocus>Child action</button></section>}
        </>
    );
}

async function render(element) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(element));
}

describe('useModalKeyboard accessibility contract', () => {
    it('moves focus into the dialog, traps Tab, closes with Escape, and restores focus', async () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();
        const onClose = vi.fn();
        await render(<Dialog open onClose={onClose} />);

        const buttons = container.querySelectorAll('button');
        expect(document.activeElement).toBe(buttons[0]);
        Object.defineProperty(buttons[0], 'offsetParent', { configurable: true, value: buttons[0].parentElement });
        Object.defineProperty(buttons[1], 'offsetParent', { configurable: true, value: buttons[1].parentElement });
        buttons[1].focus();
        await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
        expect(document.activeElement).toBe(buttons[0]);

        await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(onClose).toHaveBeenCalledOnce();
        await act(async () => root.render(<Dialog open={false} onClose={onClose} />));
        expect(document.activeElement).toBe(opener);
        opener.remove();
    });

    it('closes only the topmost dialog when dialogs are nested', async () => {
        const onParentClose = vi.fn();
        const onChildClose = vi.fn();
        await render(
            <NestedDialogs
                parentOpen
                childOpen
                onParentClose={onParentClose}
                onChildClose={onChildClose}
            />,
        );

        await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(onChildClose).toHaveBeenCalledOnce();
        expect(onParentClose).not.toHaveBeenCalled();

        await act(async () => root.render(
            <NestedDialogs
                parentOpen
                childOpen={false}
                onParentClose={onParentClose}
                onChildClose={onChildClose}
            />,
        ));
        await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(onParentClose).toHaveBeenCalledOnce();
    });
});
