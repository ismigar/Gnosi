/**
 * useVaultSelectionShortcuts.js
 * Hook per registrar dreceres de teclat per a la selecció múltiple del Vault.
 */
import { useEffect } from 'react';

/**
 * @param {Object} params
 * @param {Function} params.selectAll       - Selecciona tots els registres
 * @param {Function} params.clearSelection  - Esborra la selecció
 * @param {Function} params.onDeleteSelected - Elimina els registres seleccionats
 * @param {boolean}  params.enabled         - Si les dreceres estan actives
 */
export function useVaultSelectionShortcuts({ selectAll, clearSelection, onDeleteSelected, enabled = true }) {
    useEffect(() => {
        if (!enabled) return;

        const handleKeyDown = (e) => {
            // Ctrl/Cmd + A → Seleccionar tots
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                // Evitar interferir amb inputs de text
                const tag = document.activeElement?.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
                e.preventDefault();
                selectAll?.();
            }

            // Escape → Esborrar selecció
            if (e.key === 'Escape') {
                clearSelection?.();
            }

            // Delete / Backspace → Eliminar seleccionats (si no hi ha focus en inputs)
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
