/**
 * VaultBulkActionsBar.jsx
 * Barra d'accions en massa per als registres seleccionats del Vault.
 * S'amaga si no hi ha cap registre seleccionat.
 *
 * Accions sempre disponibles: eliminar, seleccionar tots, tancar.
 * Accions opcionals (si el caller passa els callbacks): canviar tipus,
 * exportar selecció a BibTeX/RIS.
 */
import React, { useState, useRef, useEffect } from 'react';
import { Trash2, X, CheckSquare, Tag, Download, ChevronDown, Languages } from 'lucide-react';

/**
 * @param {Object} props
 * @param {Set}       props.selectedIds        - IDs dels registres seleccionats
 * @param {Function}  props.onClearSelection   - Esborra la selecció
 * @param {Function}  props.onDeleteSelected   - Elimina els registres seleccionats
 * @param {Function}  props.onSelectAll        - Selecciona tots els registres visibles
 * @param {number}    props.totalCount         - Total de registres visibles
 * @param {Array<{value, label}>=} props.itemTypeOptions - Opcions per a "Canviar tipus"
 * @param {Function=} props.onChangeItemType   - (value) → void; rep el tipus triat
 * @param {Function=} props.onExportSelection  - (fmt: 'bibtex'|'ris') → void
 * @param {Function=} props.onTranslateSelection - () → void; obre el modal de traducció massiva
 */
export function VaultBulkActionsBar({
    selectedIds,
    onClearSelection,
    onDeleteSelected,
    onSelectAll,
    totalCount = 0,
    itemTypeOptions,
    onChangeItemType,
    onExportSelection,
    onTranslateSelection,
}) {
    const [typeMenuOpen, setTypeMenuOpen] = useState(false);
    const [exportMenuOpen, setExportMenuOpen] = useState(false);
    const typeMenuRef = useRef(null);
    const exportMenuRef = useRef(null);

    // Tanca dropdowns al click fora.
    useEffect(() => {
        const handler = (e) => {
            if (typeMenuRef.current && !typeMenuRef.current.contains(e.target)) setTypeMenuOpen(false);
            if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setExportMenuOpen(false);
        };
        if (typeMenuOpen || exportMenuOpen) document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [typeMenuOpen, exportMenuOpen]);

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

            {/* Canviar tipus (opcional) */}
            {onChangeItemType && itemTypeOptions?.length > 0 && (
                <div className="relative" ref={typeMenuRef}>
                    <button
                        onClick={() => setTypeMenuOpen((o) => !o)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                        title="Canviar Item Type"
                    >
                        <Tag size={13} />
                        Canviar tipus
                        <ChevronDown size={11} />
                    </button>
                    {typeMenuOpen && (
                        <div className="absolute bottom-full mb-1 left-0 min-w-[200px] max-h-[280px] overflow-y-auto rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg py-1 z-50">
                            {itemTypeOptions.map((opt) => (
                                <button
                                    key={opt.value}
                                    onClick={() => { onChangeItemType(opt.value); setTypeMenuOpen(false); }}
                                    className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Exportar selecció (opcional) */}
            {onExportSelection && (
                <div className="relative" ref={exportMenuRef}>
                    <button
                        onClick={() => setExportMenuOpen((o) => !o)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                        title="Exportar selecció"
                    >
                        <Download size={13} />
                        Exportar
                        <ChevronDown size={11} />
                    </button>
                    {exportMenuOpen && (
                        <div className="absolute bottom-full mb-1 left-0 min-w-[130px] rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg py-1 z-50">
                            <button
                                onClick={() => { onExportSelection('bibtex'); setExportMenuOpen(false); }}
                                className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                            >
                                BibTeX (.bib)
                            </button>
                            <button
                                onClick={() => { onExportSelection('ris'); setExportMenuOpen(false); }}
                                className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                            >
                                RIS (.ris)
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Traduir selecció (opcional) */}
            {onTranslateSelection && (
                <button
                    onClick={onTranslateSelection}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                    title="Traduir seleccionats"
                >
                    <Languages size={13} />
                    Traduir
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
