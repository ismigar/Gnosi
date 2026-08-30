import { act, useRef } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { useModalKeyboard } from './useModalKeyboard';
import { dispatchWindowEvent } from '../platform/browser-events';

interface DialogProps {
    readonly label?: string;
    readonly onClose: () => void;
    readonly open: boolean;
}

interface NestedDialogsProps {
    readonly childOpen: boolean;
    readonly onChildClose: () => void;
    readonly onParentClose: () => void;
    readonly parentOpen: boolean;
}

interface MountedDialog {
    readonly container: HTMLDivElement;
    readonly root: Root;
}

let mountedDialog: MountedDialog | null = null;
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};

beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    const mounted = mountedDialog;
    if (mounted) {
        act(() => {
            mounted.root.unmount();
        });
        mounted.container.remove();
    }
    mountedDialog = null;
});

function Dialog({ open, onClose, label = 'Test dialog' }: DialogProps) {
    const dialogRef = useRef<HTMLElement | null>(null);
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

function EmptyDialog({ open, onClose }: DialogProps) {
    const dialogRef = useRef<HTMLElement | null>(null);
    useModalKeyboard({
        isOpen: open,
        onClose,
        containerRef: dialogRef,
        trapFocus: true,
    });
    if (!open) return null;
    return (
        <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Empty dialog"
        />
    );
}

function NestedDialogs({
    parentOpen,
    childOpen,
    onParentClose,
    onChildClose,
}: NestedDialogsProps) {
    const parentRef = useRef<HTMLElement | null>(null);
    const childRef = useRef<HTMLElement | null>(null);
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
            {parentOpen && (
                <section
                    ref={parentRef}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Parent"
                >
                    <button type="button">Parent action</button>
                </section>
            )}
            {childOpen && (
                <section
                    ref={childRef}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Child"
                >
                    <button type="button" data-autofocus>Child action</button>
                </section>
            )}
        </>
    );
}

function render(element: ReactElement): MountedDialog {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const mounted = { container, root };
    mountedDialog = mounted;
    act(() => {
        root.render(element);
    });
    return mounted;
}

function dispatchKey(key: string): void {
    act(() => {
        dispatchWindowEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
}

describe('useModalKeyboard accessibility contract', () => {
    it('captures Escape before a child stops propagation and releases it on close', () => {
        const onClose = vi.fn();
        const { container, root } = render(<Dialog open onClose={onClose} />);
        const button = container.querySelector('button');
        if (!button) throw new Error('Expected dialog button');
        button.addEventListener('keydown', (event) => { event.stopPropagation(); });
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        act(() => { button.dispatchEvent(event); });
        expect(onClose).toHaveBeenCalledOnce();
        expect(event.defaultPrevented).toBe(true);
        act(() => { root.render(<Dialog open={false} onClose={onClose} />); });
        dispatchKey('Escape');
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('moves focus into the dialog, traps Tab, closes with Escape, and restores focus', () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();
        const onClose = vi.fn();
        const { container, root } = render(<Dialog open onClose={onClose} />);

        const buttons = container.querySelectorAll('button');
        const firstButton = buttons[0];
        const lastButton = buttons[1];
        if (!(firstButton instanceof HTMLButtonElement)
            || !(lastButton instanceof HTMLButtonElement)) {
            throw new Error('Expected both dialog buttons.');
        }
        expect(document.activeElement).toBe(firstButton);
        Object.defineProperty(firstButton, 'offsetParent', {
            configurable: true,
            value: firstButton.parentElement,
        });
        Object.defineProperty(lastButton, 'offsetParent', {
            configurable: true,
            value: lastButton.parentElement,
        });
        lastButton.focus();
        dispatchKey('Tab');
        expect(document.activeElement).toBe(firstButton);

        dispatchKey('Escape');
        expect(onClose).toHaveBeenCalledOnce();
        act(() => {
            root.render(<Dialog open={false} onClose={onClose} />);
        });
        expect(document.activeElement).toBe(opener);
        opener.remove();
    });

    it('closes only the topmost dialog when dialogs are nested', () => {
        const onParentClose = vi.fn();
        const onChildClose = vi.fn();
        const { root } = render(
            <NestedDialogs
                parentOpen
                childOpen
                onParentClose={onParentClose}
                onChildClose={onChildClose}
            />,
        );

        dispatchKey('Escape');
        expect(onChildClose).toHaveBeenCalledOnce();
        expect(onParentClose).not.toHaveBeenCalled();

        act(() => {
            root.render(
                <NestedDialogs
                    parentOpen
                    childOpen={false}
                    onParentClose={onParentClose}
                    onChildClose={onChildClose}
                />,
            );
        });
        dispatchKey('Escape');
        expect(onParentClose).toHaveBeenCalledOnce();
    });

    it('focuses an empty dialog container and keeps Tab inside it', () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();
        const onClose = vi.fn();
        const { container, root } = render(<EmptyDialog open onClose={onClose} />);

        const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
        if (!dialog) throw new Error('Expected the empty dialog.');
        expect(dialog.getAttribute('tabindex')).toBe('-1');
        expect(document.activeElement).toBe(dialog);

        dispatchKey('Tab');
        expect(document.activeElement).toBe(dialog);

        act(() => {
            root.render(<EmptyDialog open={false} onClose={onClose} />);
        });
        expect(document.activeElement).toBe(opener);
        opener.remove();
    });
});
