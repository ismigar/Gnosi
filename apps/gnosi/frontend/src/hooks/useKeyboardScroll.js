import { useEffect } from 'react';

/**
 * Handles keyboard vertical scrolling (ArrowUp, ArrowDown, PageUp, PageDown, Space, Home, End)
 * for a target container while ignoring typing events in form fields.
 */
export function useKeyboardScroll(scrollContainerRef, options = {}) {
    const { enabled = true, modalOpen = false, step = 80 } = options;

    useEffect(() => {
        if (!enabled || modalOpen) return;

        const handleKeyDown = (e) => {
            const active = document.activeElement;
            const isInput = active && (
                active.tagName === 'INPUT' ||
                active.tagName === 'TEXTAREA' ||
                active.tagName === 'SELECT' ||
                active.isContentEditable
            );
            if (isInput) return;

            const target = scrollContainerRef?.current;
            if (!target) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                target.scrollBy({ top: step, behavior: 'smooth' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                target.scrollBy({ top: -step, behavior: 'smooth' });
            } else if (e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) {
                e.preventDefault();
                target.scrollBy({ top: target.clientHeight * 0.8, behavior: 'smooth' });
            } else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
                e.preventDefault();
                target.scrollBy({ top: -target.clientHeight * 0.8, behavior: 'smooth' });
            } else if (e.key === 'Home') {
                e.preventDefault();
                target.scrollTo({ top: 0, behavior: 'smooth' });
            } else if (e.key === 'End') {
                e.preventDefault();
                target.scrollTo({ top: target.scrollHeight, behavior: 'smooth' });
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [enabled, modalOpen, step, scrollContainerRef]);
}
