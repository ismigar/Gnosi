import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { NormalizedOption } from '../optionCatalogUtils';
import type { RemoveOptionState } from './types';
export function RemoveOptionDialog({ state, options, onCancel, onConfirm }: { state: RemoveOptionState; options: NormalizedOption[]; onCancel: () => void; onConfirm: (value: string | null) => void }) {
    const { t } = useTranslation();
    // The parent remounts the dialog via key on each opening: useState starts clean.
    const [reassignTo, setReassignTo] = useState('');
    if (!state.isOpen) return null;
    const others = options.filter((o) => o.name !== state.value);
    return createPortal(
        <div
            className="fixed inset-0 z-[var(--z-modal-dropdown)] flex items-center justify-center bg-black/40"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
        >
            <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl w-full max-w-md p-5 animate-in zoom-in-95 duration-150">
                <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2">
                    {t('schema.confirm_remove_option_title', "Delete option")}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] mb-3">
                    {typeof state.usageCount === 'number' && state.usageCount > 0
                        ? t('schema.remove_option_in_use', { name: state.value, count: state.usageCount, defaultValue: "The option “{{name}}” is used by {{count}} records. What should we do with their values?" })
                        : t('schema.remove_option_unused', { name: state.value, defaultValue: "Are you sure you want to delete the option “{{name}}”?" })}
                </p>
                {state.protectedReason && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
                        {state.protectedReason}
                    </p>
                )}
                {others.length > 0 && (
                    <label className="flex items-center gap-2 mb-4 text-sm text-[var(--text-secondary)]">
                        {t('schema.remove_option_reassign', "Reassign to")}
                        <select
                            value={reassignTo}
                            onChange={(e) => { setReassignTo(e.target.value); }}
                            className="flex-1 text-sm border border-[var(--border-primary)] rounded-md px-2 py-1 bg-[var(--bg-secondary)] text-[var(--text-primary)] outline-none"
                        >
                            <option value="">{t('schema.remove_option_clear', "— clear the values —")}</option>
                            {others.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                        </select>
                    </label>
                )}
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-md transition-colors">
                        {t('common.cancel', "Cancel")}
                    </button>
                    <button type="button" onClick={() => { onConfirm(reassignTo || null); }} className="btn-gnosi-danger px-3 py-1.5 text-sm rounded-md">
                        {t('schema.confirm_remove_option_confirm', "Delete")}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
