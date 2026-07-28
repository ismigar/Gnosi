import { useCallback, useEffect, useState } from 'react';

const FLOATING_DOCK_EVENT = 'gnosi:floating-dock-change';

export function announceFloatingDockChange(isOpen) {
    window.dispatchEvent(new CustomEvent(FLOATING_DOCK_EVENT, { detail: { isOpen } }));
}

export function useFloatingActionDock() {
    const [isOpen, setIsOpen] = useState(() => document.body.dataset.gnosiFloatingDock === 'open');

    useEffect(() => {
        const sync = (event) => setIsOpen(Boolean(event.detail?.isOpen));
        window.addEventListener(FLOATING_DOCK_EVENT, sync);
        return () => window.removeEventListener(FLOATING_DOCK_EVENT, sync);
    }, []);

    const setDockOpen = useCallback((nextValue) => {
        const next = typeof nextValue === 'function' ? nextValue(isOpen) : nextValue;
        document.body.dataset.gnosiFloatingDock = next ? 'open' : '';
        if (!next) delete document.body.dataset.gnosiFloatingDock;
        announceFloatingDockChange(next);
    }, [isOpen]);

    return [isOpen, setDockOpen];
}
