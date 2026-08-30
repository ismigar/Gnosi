import { useEffect, useEffectEvent } from 'react';
import { pushModalLayer } from '../../../hooks/useModalKeyboard';
import { subscribeDocumentEvent, subscribeElementEvent } from '../../../shared/platform/browser-events';
import type { SchemaState } from './useSchemaState';
import type { ResolvedProps } from './props';
export function useSchemaKeyboard(state: SchemaState, props: ResolvedProps) {
    const { modalRef, modalLayerRef, scrollRef } = state;
    const { isOpen, onClose } = props;
    const registerModalLayer = useEffectEvent(() => {
        if (!isOpen) return;
        // Layer in the global modal stack: this modal can be nested INSIDE
        // of Settings (Notion Import) and having a ConfirmModal on top.
        // Each Esc should only close the top layer (cf. useModalKeyboard).
        const layer = pushModalLayer();
        modalLayerRef.current = layer;
        const el = modalRef.current;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                if (layer.isTop()) onClose();
            }
        };
        const unsubscribe = el ? subscribeElementEvent(el, 'keydown', handleKeyDown) : undefined;
        // Focus on the scrollable BODY (not the root): this way Esc works (the keydown
        // bubbles up to `el`) and, additionally, it can be scrolled with the keyboard.
        // Giving focus to the root (not scrollable) broke keyboard scrolling.
        scrollRef.current?.focus();
        return () => {
            unsubscribe?.();
            layer.release();
            modalLayerRef.current = null;
        };

    });
    useEffect(() => registerModalLayer(), [isOpen]);

    // Global flag while the modal is open: VaultTable checks it to
    // disable grid cell navigation. Without this, with a
    // active cell, the grid handler (on window) remained EVERY
    // arrow (it moved the cursor under the modal and the preventDefault killed the
    // native scroll of the body) and, with focus on <body>, a letter or ⌫ would edit or
    // was blindly clearing cells beneath the modal.
    const markModalOpen = useEffectEvent(() => {
        if (!isOpen) return;
        document.body.classList.add('gnosi-modal-open');
        return () => { document.body.classList.remove('gnosi-modal-open'); };
    });
    useEffect(() => markModalOpen(), [isOpen]);

    // Keyboard scroll always lives inside the modal. The browser only scrolls
    // the scrollable ancestor of the FOCUSED element, and here focus is lost
    // continuously: a click on the header/frame/backdrop leaves it on <body>
    // (and those keydowns don't even bubble through modalRef: that's why the listener goes
    // on document), and a click "inside" almost always lands on a field, which
    // keeps the focus. Policy depending on where the focus is:
    //  - body or modal chrome: all scroll keys, including Home/End;
    //  - text inputs (the bulk of the modal): arrows and Page Up/Down scroll
    //    (with preventDefault the caret doesn't move), but Home/End and the keys
    //    with Shift (selection) are left for the caret; the input types where
    //    arrows DO work (number, date, radio…) are left untouched;
    //  - select, textarea, and contenteditable: nothing is touched (their own semantics);
    //  - dnd-kit handles ([aria-roledescription]): nothing is touched, since
    //    keyboard drag (Space + arrows) is theirs — that's why space isn't either
    //    is not handled anywhere (enables buttons);
    //  - everything else (including the scrollable body): WE scroll it ourselves with preventDefault.
    //    We never delegate to native scroll: verified live that, even with
    //    the focus to the body and the event clear of preventDefault, Chrome didn't scroll
    //    (and with our preventDefault, there can never be double scrolling);
    //  - focus on another overlay (nested ConfirmModal): nothing is touched.
    const registerKeyboardScroll = useEffectEvent(() => {
        if (!isOpen) return;
        const FLETXES_DEL_CONTROL = new Set(['number', 'range', 'date', 'time', 'datetime-local', 'month', 'week', 'radio']);
        const handler = (e: KeyboardEvent) => {
            if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            const main = scrollRef.current;
            if (!main) return;
            const t = e.target;
            const focusAlBody = t === document.body || t === document.documentElement;
            const dinsDelModal = t instanceof Element && modalRef.current?.contains(t);
            if (!focusAlBody && !dinsDelModal) return;
            // Esc with focus on <body> (click on the chrome): the Esc listener of
            // modalRef doesn't see these events (they don't bubble there). For the ones inside
            // the modal we never get past here: that listener calls stopPropagation.
            if (e.key === 'Escape' && focusAlBody) {
                if (modalLayerRef.current?.isTop()) onClose();
                return;
            }
            if (dinsDelModal && t.closest('[aria-roledescription]')) return; // nansa dnd-kit
            let nomesVerticals = false;
            const control = dinsDelModal ? t.closest('select, textarea, input, [contenteditable="true"]') : null;
            if (control) {
                const esInputDeText = control instanceof HTMLInputElement && !FLETXES_DEL_CONTROL.has(control.type);
                if (!esInputDeText) return;
                nomesVerticals = true; // Home/End remain for the caret
            }
            const pagina = main.clientHeight * 0.9;
            const salts: Record<string, number> = { ArrowDown: 48, ArrowUp: -48, PageDown: pagina, PageUp: -pagina };
            if (e.key in salts) {
                main.scrollBy({ top: salts[e.key] });
            } else if (e.key === 'Home' && !nomesVerticals) {
                main.scrollTo({ top: 0 });
            } else if (e.key === 'End' && !nomesVerticals) {
                main.scrollTo({ top: main.scrollHeight });
            } else {
                return;
            }
            e.preventDefault();
        };
        return subscribeDocumentEvent('keydown', handler);

    });
    useEffect(() => registerKeyboardScroll(), [isOpen]);

    // Scroll fix (Mac+Chrome): native <select>/<input>/<textarea> absorb
    // the wheel when the cursor is over it and the modal body doesn't scroll. Since
    // this modal is full of controls (fields + Drupal mapping), we redirect
    // the wheel to the scrollable body. Same pattern as GlobalSettingsModal.
    const registerWheelScroll = useEffectEvent(() => {
        if (!isOpen) return;
        const handler = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) return; // respecta pinch/zoom
            const t = e.target;
            const main = scrollRef.current;
            if (!(t instanceof HTMLElement) || !main || !main.contains(t)) return;
            const tag = t.tagName;
            if (tag !== 'SELECT' && tag !== 'INPUT' && tag !== 'TEXTAREA') return;
            // textarea with its own scroll: let it manage it itself
            if (tag === 'TEXTAREA' && t.scrollHeight > t.clientHeight + 1) return;
            if (main.scrollHeight > main.clientHeight) {
                main.scrollTop += e.deltaY;
                e.preventDefault();
            }
        };
        return subscribeDocumentEvent('wheel', handler, { passive: false, capture: true });
    });
    useEffect(() => registerWheelScroll(), [isOpen]);
}
