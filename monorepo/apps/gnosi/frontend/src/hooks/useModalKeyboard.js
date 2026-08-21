/**
 * useModalKeyboard.js
 * CANONICAL keyboard handling for Gnosi modals.
 *
 *   Esc   → negative action (cancel / close)  — always, unconditionally
 *   Enter → positive action (confirm)            — with safeguards
 *   Tab   → focus-trap inside the modal              — optional (trapFocus)
 *
 * Why in CAPTURE phase and on `window`:
 *   Editors and pickers inside the modal (BlockEditor, dnd-kit, MultiSelectPills…)
 *   call `stopPropagation()` on their keydown. If we listened during bubbling,
 *   the event would never reach the listener and Esc would "not respond" depending on where
 *   focus happened to be. In capture, the event reaches us BEFORE any child
 *   can stop it. This is the same pattern already used by FilesystemPicker,
 *   InsertContentModal, PageViewModal, and BlockEditor.
 *
 * Why refs and not deps:
 *   Binding the listener only to `isOpen` (and not to `onClose`/`onConfirm`) avoids
 *   "churn": if we depended on callbacks recreated on every render, the listener would
 *   constantly unbind/rebind and leave windows where a real
 *   keypress is lost. We read the callbacks via ref, always up to date.
 *
 * Coexists with its own navigation (↑↓ arrows for lists): this hook ONLY touches
 * Escape, Enter (if you pass onConfirm), and Tab (if trapFocus). It leaves the rest of the
 * keys untouched, so a modal with a navigable list keeps its own arrow
 * handler and only delegates Esc/Enter here.
 *
 * @param {Object}   params
 * @param {boolean}  params.isOpen           - Whether the modal is visible.
 * @param {Function} params.onClose          - Negative action triggered by Escape.
 * @param {Function} [params.onConfirm]      - Positive action (Enter). Omit it if the modal doesn't have one (e.g. dropdowns or lists with their own Enter handling).
 * @param {boolean}  [params.confirmDisabled] - If true, Enter does not confirm (mirrors the disabled primary button).
 * @param {React.RefObject} [params.containerRef] - Ref to the modal panel. Enter only confirms if focus is inside it; required for trapFocus.
 * @param {boolean}  [params.closeOnEscape]  - Allows disabling Esc in very specific cases (defaults to true).
 * @param {boolean}  [params.trapFocus]      - If true, Tab cycles within the modal and focus is restored on close (requires containerRef).
 */
import { useEffect, useRef } from 'react';

// ── Global stack of modal layers ──────────────────────────────────────────
// With NESTED modals (Settings → Import Notion → schema / confirmation),
// each Esc must close only the TOP modal, not the whole stack at once: since
// this hook listens on `window` in the capture phase, without the stack the
// modal below would see the Esc from the one above and close too (the user would fall
// straight back to the home). Each open modal registers a layer when it opens and
// releases it when it closes; Esc handlers only act if their layer is
// the top one. Exported so modals with their own keyboard handling
// (SchemaConfigModal) can also be counted.
const modalLayerStack = [];

export function pushModalLayer() {
    const token = {};
    modalLayerStack.push(token);
    return {
        isTop: () => modalLayerStack[modalLayerStack.length - 1] === token,
        release: () => {
            const i = modalLayerStack.indexOf(token);
            if (i !== -1) modalLayerStack.splice(i, 1);
        },
    };
}

export function useModalKeyboard({
    isOpen,
    onClose,
    onConfirm = null,
    confirmDisabled = false,
    containerRef = null,
    closeOnEscape = true,
    trapFocus = false,
}) {
    const onCloseRef = useRef(onClose);
    const onConfirmRef = useRef(onConfirm);
    const confirmDisabledRef = useRef(confirmDisabled);
    const closeOnEscapeRef = useRef(closeOnEscape);
    // We keep the refs fresh in an effect (the react-hooks/refs rule forbids
    // write them during render). No deps array → runs after every
    // commit, so the listener (bound only via isOpen) always reads the
    // current values without having to re-register.
    useEffect(() => {
        onCloseRef.current = onClose;
        onConfirmRef.current = onConfirm;
        confirmDisabledRef.current = confirmDisabled;
        closeOnEscapeRef.current = closeOnEscape;
    });

    useEffect(() => {
        if (!isOpen) return undefined;

        // Registers this modal in the layer stack: only the top one responds to Esc.
        const layer = pushModalLayer();

        // We remember who had focus BEFORE opening, to restore it on close
        // (accessibility). Works because modals no longer use HTML autoFocus
        // (which would move focus before this line): the initial focus is set by
        // this hook further down, after capturing the external element.
        const previouslyFocused = trapFocus ? document.activeElement : null;
        // Snapshot of the panel node for the cleanup: by the time it runs the
        // ref may already be nulled (unmount), and a detached node can't
        // contain the active element anyway.
        const panelEl = containerRef?.current || null;

        // Initial focus inside the modal: the element marked with [data-autofocus], or
        // the first focusable element, or the panel itself. Synchronous inside the effect (NOT in
        // requestAnimationFrame, which pauses in background tabs). The
        // content is already in the DOM when the effect runs. Only with trapFocus.
        if (trapFocus && containerRef?.current) {
            const root = containerRef.current;
            if (!root.contains(document.activeElement)) {
                const target = root.querySelector('[data-autofocus]')
                    || root.querySelector(
                        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                    )
                    || root;
                try { target?.focus?.(); } catch { /* The element may not be focusable. */ }
            }
        }

        const getFocusable = () => {
            const root = containerRef?.current;
            if (!root) return [];
            return Array.from(
                root.querySelectorAll(
                    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                ),
            ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        };

        const handleKeyDown = (e) => {
            if (closeOnEscapeRef.current && e.key === 'Escape') {
                // With a nested modal open on top (upper layer of another one),
                // the Esc belongs to it: we neither close nor consume the event.
                if (!layer.isTop()) return;
                e.preventDefault();
                onCloseRef.current?.();
                return;
            }

            // Focus trap: Tab cycles within the modal (optional).
            if (trapFocus && e.key === 'Tab') {
                const items = getFocusable();
                if (items.length === 0) return;
                const root = containerRef?.current;
                const first = items[0];
                const last = items[items.length - 1];
                const active = document.activeElement;
                if (e.shiftKey) {
                    if (active === first || !root?.contains(active)) {
                        e.preventDefault();
                        last.focus();
                    }
                } else if (active === last || !root?.contains(active)) {
                    e.preventDefault();
                    first.focus();
                }
                return;
            }

            if (e.key === 'Enter' && onConfirmRef.current) {
                // Key combinations: they are not "confirm".
                if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
                // IME (Chinese, Japanese, Korean…): Enter closes the composition, not the modal.
                if (e.isComposing || e.keyCode === 229) return;

                const ae = document.activeElement;
                const tag = ae?.tagName;
                // In multiline text, Enter is a line break.
                if (tag === 'TEXTAREA' || ae?.isContentEditable) return;
                // If focus is on its own interactive element (button, link,
                // select), we leave its native behavior: so Enter on
                // "Cancel" cancels and on the primary button confirms, without
                // for the hook to override it.
                if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT') return;
                // Mirrors the disabled primary button.
                if (confirmDisabledRef.current) return;
                // Avoids confirming from a background input (outside the modal).
                if (containerRef?.current && !containerRef.current.contains(ae)) return;

                e.preventDefault();
                onConfirmRef.current();
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            layer.release();
            // Restores focus to whoever had it before opening (only with trapFocus).
            // Guarded: if the close action already placed focus somewhere else
            // (e.g. the editor body after inserting content), don't fight it.
            // And restore with preventScroll — the previous holder can live far
            // from the current viewport (the page title while scrolled down a
            // long note) and a plain focus() would yank the page to it.
            const active = document.activeElement;
            const focusIsLoose = !active
                || active === document.body
                || (panelEl ? panelEl.contains(active) : false);
            if (focusIsLoose && previouslyFocused && typeof previouslyFocused.focus === 'function') {
                try { previouslyFocused.focus({ preventScroll: true }); } catch { /* element is gone */ }
            }
        };
    }, [isOpen, containerRef, trapFocus]);
}

export default useModalKeyboard;
