import { Edit2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useModalKeyboard } from '../../../hooks/useModalKeyboard';
interface RenamePromptProps { isOpen: boolean; type: string; defaultValue: string; onClose: () => void; onConfirm: (name: string) => Promise<void>; }
export const RenamePromptModal = ({ isOpen, type, defaultValue, onClose, onConfirm }: RenamePromptProps) => {
    const { t } = useTranslation();
    const modalRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [value, setValue] = useState(defaultValue || '');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen) {
            queueMicrotask(() => { setValue(defaultValue || ''); setIsSubmitting(false); });
            const id = setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 30);
            return () => { clearTimeout(id); };
        }
    }, [isOpen, defaultValue]);

    const submit = async () => {
        const trimmed = value.trim();
        if (!trimmed || isSubmitting) return;
        if (trimmed === (defaultValue || '')) { onClose(); return; }
        try {
            setIsSubmitting(true);
            await onConfirm(trimmed);
        } finally {
            setIsSubmitting(false);
        }
    };

    useModalKeyboard({
        isOpen,
        onClose: () => { if (!isSubmitting) onClose(); },
        onConfirm: submit,
        confirmDisabled: isSubmitting || !value.trim(),
        containerRef: modalRef,
        trapFocus: true,
    });

    if (!isOpen) return null;

    const title = type === 'database'
        ? t('sidebar.rename_db_title', "Rename database")
        : t('sidebar.rename_table_title', "Rename table");
    const label = type === 'database'
        ? t('sidebar.prompt_new_name_db', "New name for the database")
        : t('sidebar.prompt_new_name_table', "New name for the table");

    return createPortal(
        <div
            className="fixed inset-0 flex items-center justify-center"
            style={{ zIndex: 'var(--z-confirm-modal)' }}
            onClick={() => { if (!isSubmitting) onClose(); }}
            role="dialog"
            aria-modal="true"
        >
            <div className="absolute inset-0 bg-[var(--bg-primary)]/40 backdrop-blur-sm transition-opacity" />
            <div
                ref={modalRef}
                onClick={(e) => { e.stopPropagation(); }}
                className="relative bg-[var(--bg-primary)] rounded-2xl shadow-xl w-full max-w-sm overflow-hidden transform transition-all animate-in fade-in zoom-in-95 duration-200 p-6 border border-[var(--border-primary)]"
            >
                <div className="flex justify-between items-start mb-4">
                    <div className="p-3 rounded-full flex-shrink-0 bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)]">
                        <Edit2 size={20} />
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="gnosi-close-btn"
                        aria-label={t('common.cancel', "Cancel")}
                    >
                        <span aria-hidden>×</span>
                    </button>
                </div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">{title}</h3>
                <label className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                    {label}
                </label>
                <input
                    ref={inputRef}
                    data-autofocus="true"
                    type="text"
                    value={value}
                    onChange={(e) => { setValue(e.target.value); }}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-blue)]/30 mb-6"
                />
                <div className="flex items-center justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="px-4 py-2 font-medium text-[var(--text-secondary)] border border-[var(--border-primary)] rounded-lg hover:bg-[var(--bg-secondary)] transition-colors focus:ring-2 focus:ring-[var(--border-primary)] outline-none"
                    >
                        {t('common.cancel', "Cancel")}
                    </button>
                    <button
                        type="button"
                        onClick={() => { void submit(); }}
                        disabled={isSubmitting || !value.trim()}
                        className="px-4 py-2 font-medium rounded-lg text-white shadow-sm transition-colors focus:ring-2 focus:ring-offset-1 outline-none bg-[var(--gnosi-blue)] hover:opacity-90 focus:ring-[var(--gnosi-blue)]/50 disabled:opacity-50"
                    >
                        {isSubmitting ? '...' : t('common.save', "Save")}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};
