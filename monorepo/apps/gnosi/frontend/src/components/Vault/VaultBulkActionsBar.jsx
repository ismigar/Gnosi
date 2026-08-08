/**
 * VaultBulkActionsBar.jsx
 * Bulk actions bar for the selected Vault records.
 * Hidden if no record is selected.
 *
 * Always-available actions: delete, select all, close.
 * Optional actions (if the caller passes the callbacks): change type,
 * export selection to BibTeX/RIS.
 */
import React, { useState, useRef, useEffect } from 'react';
import { Trash2, X, CheckSquare, Tag, Download, ChevronDown, Languages, LayoutTemplate } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * @param {Object} props
 * @param {Set}       props.selectedIds        - IDs of the selected records
 * @param {Function}  props.onClearSelection   - Clears the selection
 * @param {Function}  props.onDeleteSelected   - Deletes the selected records
 * @param {Function}  props.onSelectAll        - Selects all visible records
 * @param {number}    props.totalCount         - Total visible records
 * @param {Array<{value, label}>=} props.itemTypeOptions - Options for "Change type"
 * @param {Function=} props.onChangeItemType   - (value) → void; receives the chosen type
 * @param {Function=} props.onExportSelection  - (fmt: 'bibtex'|'ris') → void
 * @param {Function=} props.onTranslateSelection - () → void; opens the bulk translation modal
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
    templates = [],
    onApplyTemplate,
    extraActions,
}) {
    const { t } = useTranslation();
    const [typeMenuOpen, setTypeMenuOpen] = useState(false);
    const [exportMenuOpen, setExportMenuOpen] = useState(false);
    const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
    const typeMenuRef = useRef(null);
    const exportMenuRef = useRef(null);
    const templateMenuRef = useRef(null);

    // Closes dropdowns on outside click.
    useEffect(() => {
        const handler = (e) => {
            if (typeMenuRef.current && !typeMenuRef.current.contains(e.target)) setTypeMenuOpen(false);
            if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setExportMenuOpen(false);
            if (templateMenuRef.current && !templateMenuRef.current.contains(e.target)) setTemplateMenuOpen(false);
        };
        if (typeMenuOpen || exportMenuOpen || templateMenuOpen) document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [typeMenuOpen, exportMenuOpen, templateMenuOpen]);

    const count = selectedIds?.size ?? 0;
    if (count === 0) return null;

    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[var(--bg-primary)] text-[var(--text-primary)] px-4 py-2.5 rounded-xl shadow-2xl border border-[var(--border-primary)] animate-in slide-in-from-bottom-4 ring-1 ring-black/5">
            {/* Recompte */}
            <span className="text-sm font-bold text-[var(--text-secondary)]">
                {t('bulk_actions.selected_count', { count })}
            </span>

            <div className="w-px h-5 bg-[var(--border-primary)]" />

            {/* Select all */}
            {onSelectAll && count < totalCount && (
                <button
                    onClick={onSelectAll}
                    className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]/70 hover:text-[var(--text-primary)] transition-colors font-medium"
                    title={t('bulk_actions.select_all_title', "Select all")}
                >
                    <CheckSquare size={14} />
                    {t('bulk_actions.select_all_count', { count: totalCount, defaultValue: "All ({{count}})" })}
                </button>
            )}

            {/* Canviar tipus (opcional) */}
            {onChangeItemType && itemTypeOptions?.length > 0 && (
                <div className="relative" ref={typeMenuRef}>
                    <button
                        onClick={() => setTypeMenuOpen((o) => !o)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                        title={t('bulk_actions.change_type_title', "Change item type")}
                    >
                        <Tag size={13} />
                        {t('bulk_actions.change_type', "Change type")}
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

            {/* Export selection (optional) */}
            {onExportSelection && (
                <div className="relative" ref={exportMenuRef}>
                    <button
                        onClick={() => setExportMenuOpen((o) => !o)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                        title={t('bulk_actions.export_title', "Export selection")}
                    >
                        <Download size={13} />
                        {t('bulk_actions.export', "Export")}
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

            {/* Translate selection (optional) */}
            {onTranslateSelection && (
                <button
                    onClick={onTranslateSelection}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                    title={t('bulk_actions.translate_title', "Translate selected")}
                >
                    <Languages size={13} />
                    {t('translate.submit', "Translate")}
                </button>
            )}

            {onApplyTemplate && templates.length > 0 && (
                <div className="relative" ref={templateMenuRef}>
                    <button
                        onClick={() => setTemplateMenuOpen((open) => !open)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                        title={t('bulk_actions.apply_template_title', 'Apply template')}
                    >
                        <LayoutTemplate size={13} />
                        {t('bulk_actions.apply_template', 'Apply template')}
                        <ChevronDown size={11} />
                    </button>
                    {templateMenuOpen && (
                        <div className="absolute bottom-full mb-1 left-0 min-w-[200px] max-h-[280px] overflow-y-auto rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg py-1 z-50">
                            {templates.map((template) => (
                                <button
                                    key={template.id}
                                    onClick={() => { onApplyTemplate(template.id); setTemplateMenuOpen(false); }}
                                    className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                                >
                                    {template.title || t('common.untitled', 'Untitled')}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {extraActions}

            {/* Delete */}
            <button
                onClick={onDeleteSelected}
                className="btn-gnosi btn-gnosi-danger !px-3 !py-1.5 !rounded-lg"
                title={t('bulk_actions.delete_title', "Delete selected")}
            >
                <Trash2 size={13} />
                {t('common.delete', "Delete")}
            </button>

            {/* Close */}
            <button
                onClick={onClearSelection}
                className="p-1.5 text-[var(--text-tertiary)]/60 hover:text-[var(--text-primary)] transition-colors rounded-md hover:bg-[var(--bg-secondary)]"
                title={t('bulk_actions.deselect_title', "Deselect")}
            >
                <X size={14} />
            </button>
        </div>
    );
}
