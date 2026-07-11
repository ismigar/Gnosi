/**
 * useVaultSelectionShortcuts.js
 * Hook to register keyboard shortcuts for multiple selection in the Vault.
 */
import { useEffect } from 'react';

/**
 * @param {Object} params
 * @param {Function} params.selectAll       - Selects all records
 * @param {Function} params.clearSelection  - Clears the selection
 * @param {Function} params.onDeleteSelected - Deletes the selected records
 * @param {boolean}  params.enabled         - Whether the shortcuts are active
 */
export function useVaultSelectionShortcuts({ selectAll, clearSelection, onDeleteSelected, enabled = true }) {
    useEffect(() => {
        if (!enabled) return;

        const handleKeyDown = (e) => {
            // Ctrl/Cmd + A → Select all
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                // Avoid interfering with text inputs
                const tag = document.activeElement?.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
                e.preventDefault();
                selectAll?.();
            }

            // Escape → Clear selection
            if (e.key === 'Escape') {
                clearSelection?.();
            }

            // Delete / Backspace → Delete selected (if focus is not in inputs)
            if ((e.key === 'Delete' || e.key === 'Backspace') && onDeleteSelected) {
                const tag = document.activeElement?.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
                onDeleteSelected?.();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectAll, clearSelection, onDeleteSelected, enabled]);
}
