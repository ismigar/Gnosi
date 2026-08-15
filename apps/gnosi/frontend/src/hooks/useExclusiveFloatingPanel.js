import { useEffect } from 'react';

const FLOATING_PANEL_EVENT = 'gnosi:floating-panel-open';

export function announceFloatingPanelOpen(panelId) {
    window.dispatchEvent(new CustomEvent(FLOATING_PANEL_EVENT, {
        detail: { panelId },
    }));
}

export function useExclusiveFloatingPanel(panelId, isOpen, setOpen) {
    useEffect(() => {
        const handlePanelOpen = (event) => {
            if (isOpen && event.detail?.panelId !== panelId) {
                setOpen(false);
            }
        };
        window.addEventListener(FLOATING_PANEL_EVENT, handlePanelOpen);
        return () => window.removeEventListener(FLOATING_PANEL_EVENT, handlePanelOpen);
    }, [isOpen, panelId, setOpen]);

    useEffect(() => {
        if (!isOpen) return undefined;
        document.body.dataset.gnosiFloatingPanel = panelId;
        return () => {
            if (document.body.dataset.gnosiFloatingPanel === panelId) {
                delete document.body.dataset.gnosiFloatingPanel;
            }
        };
    }, [isOpen, panelId]);
}
