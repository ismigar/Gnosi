import { act, useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import { hasOpenModal, useModalKeyboard } from '../hooks/useModalKeyboard';
import { ModalPortal } from './ModalPortal';
import { PaneVisibilityContext } from './PaneVisibility';

function Dialog({ onClose }: { readonly onClose: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    useModalKeyboard({ isOpen: true, onClose, containerRef: ref, trapFocus: true });
    return <ModalPortal><div ref={ref} role="dialog" aria-modal="true">
        <input aria-label="Draft" defaultValue="Unsubmitted draft" />
        <input aria-label="Language" type="checkbox" />
        <button onClick={onClose}>Close</button>
    </div></ModalPortal>;
}

describe('shared modal interaction boundary', () => {
    it('keeps dialog clicks out of the editor while preserving native control actions', () => {
        const background = vi.fn(); const close = vi.fn();
        mountTestComponent(<div onClick={background} onPointerDown={background}>
            <Dialog onClose={close} />
        </div>);
        const language = document.querySelector<HTMLInputElement>('[aria-label="Language"]');
        if (!language) throw new Error('Missing language');
        act(() => { language.click(); });
        expect(language.checked).toBe(true);
        expect(background).not.toHaveBeenCalled();
        act(() => { document.querySelector<HTMLButtonElement>('[role="dialog"] button')?.click(); });
        expect(close).toHaveBeenCalledOnce();
    });

    it('releases a hidden document modal without losing its draft or consuming Escape', () => {
        const close = vi.fn();
        const tree = (visible: boolean) => <PaneVisibilityContext.Provider value={visible}><Dialog onClose={close} /></PaneVisibilityContext.Provider>;
        const mounted = mountTestComponent(tree(true));
        const input = document.querySelector<HTMLInputElement>('[aria-label="Draft"]');
        if (!input) throw new Error('Missing draft');
        input.value = 'Retain this text';
        expect(hasOpenModal()).toBe(true);
        mounted.render(tree(false));
        expect(hasOpenModal()).toBe(false);
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(close).not.toHaveBeenCalled();
        mounted.render(tree(true));
        expect(document.querySelector('[aria-label="Draft"]')).toBe(input);
        expect(input.value).toBe('Retain this text');
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(close).toHaveBeenCalledOnce();
        mounted.unmount();
        expect(hasOpenModal()).toBe(false);
    });
});
