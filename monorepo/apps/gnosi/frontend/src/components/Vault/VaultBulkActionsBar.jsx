/**
 * VaultBulkActionsBar.jsx
 * Barra d'accions en massa per als registres seleccionats del Vault.
 * S'amaga si no hi ha cap registre seleccionat.
 */
import React from 'react';
import { Trash2, X, CheckSquare } from 'lucide-react';

/**
 * @param {Object} props
 * @param {Set}      props.selectedIds      - IDs dels registres seleccionats
 * @param {Function} props.onClearSelection - Esborra la selecció
 * @param {Function} props.onDeleteSelected - Elimina els registres seleccionats
 * @param {Function} props.onSelectAll      - Selecciona tots els registres visibles
 * @param {number}   props.totalCount       - Total de registres visibles
 */
export function VaultBulkActionsBar({ selectedIds, onClearSelection, onDeleteSelected, onSelectAll, totalCount = 0 }) {
    const count = selectedIds?.size ?? 0;
    if (count === 0) return null;

    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[var(--bg-primary)] text-[var(--text-primary)] px-4 py-2.5 rounded-xl shadow-2xl border border-[var(--border-primary)] animate-in slide-in-from-bottom-4 ring-1 ring-black/5">
            {/* Recompte */}
            <span className="text-sm font-bold text-[var(--text-secondary)]">
                {count} seleccionat{count !== 1 ? 's' : ''}
            </span>

            <div className="w-px h-5 bg-[var(--border-primary)]" />

            {/* Seleccionar tots */}
            {onSelectAll && count < totalCount && (
                <button
                    onClick={onSelectAll}
                    className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]/70 hover:text-[var(--text-primary)] transition-colors font-medium"
                    title="Seleccionar tots"
                >
                    <CheckSquare size={14} />
                    Tots ({totalCount})
                </button>
            )}

            {/* Eliminar */}
            <button
                onClick={onDeleteSelected}
                className="btn-gnosi btn-gnosi-danger !px-3 !py-1.5 !rounded-lg"
                title="Eliminar seleccionats"
            >
                <Trash2 size={13} />
                Eliminar
            </button>

            {/* Tancar */}
            <button
                onClick={onClearSelection}
                className="p-1.5 text-[var(--text-tertiary)]/60 hover:text-[var(--text-primary)] transition-colors rounded-md hover:bg-[var(--bg-secondary)]"
                title="Desseleccionar"
            >
                <X size={14} />
            </button>
        </div>
    );
}
