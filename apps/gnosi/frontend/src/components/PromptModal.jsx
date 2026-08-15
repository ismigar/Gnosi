import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, X } from 'lucide-react';
import { useModalKeyboard } from '../hooks/useModalKeyboard';

/**
 * Centered input modal (Gnosi aesthetic). Replaces `window.prompt` (see the
 * native_dialog_purge directive). Controlled: `isOpen` / `onClose` / `onSubmit(value)`.
 * `onSubmit` receives the entered text (trimmed); the modal closes when it resolves without error.
 */
export const PromptModal = ({
    isOpen,
    onClose,
    onSubmit,
    title,
    message = "",
    label = "",
    placeholder = "",
    defaultValue = "",
    confirmText,
    cancelText,
    inputType = "text",
    required = true,
}) => {
    const { t } = useTranslation();
    const resolvedTitle = title ?? t('common.prompt_modal_title', "Enter a value");
    const resolvedConfirmText = confirmText ?? t('common.ok', "OK");
    const resolvedCancelText = cancelText ?? t('common.cancel_short', "Cancel");
    const modalRef = useRef(null);
    const inputRef = useRef(null);
    const [value, setValue] = useState(defaultValue);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Resets the value every time it opens (with the current defaultValue).
    useEffect(() => {
        if (isOpen) {
            setValue(defaultValue);
            setIsSubmitting(false);
            // autofocus + selects the existing content
            const id = setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select?.(); }, 0);
            return () => clearTimeout(id);
        }
    }, [isOpen, defaultValue]);

    const handleSubmit = useCallback(async () => {
        if (isSubmitting) return;
        const v = (value || '').trim();
        if (required && !v) { inputRef.current?.focus(); return; }
        try {
            setIsSubmitting(true);
            await onSubmit(v);
        } catch (err) {
            console.error('[PromptModal] Error in onSubmit:', err);
        } finally {
            setIsSubmitting(false);
        }
    }, [isSubmitting, value, required, onSubmit]);

    // Esc closes, Tab does focus-trap. We handle Enter in the input (submits).
    useModalKeyboard({
        isOpen,
        onClose: () => { if (!isSubmitting) onClose(); },
        confirmDisabled: true,
        containerRef: modalRef,
        trapFocus: true,
    });

    if (!isOpen) return null;

    const handleBackdropClick = () => { if (!isSubmitting) onClose(); };

    return (
        <div
            className="fixed inset-0 flex items-center justify-center"
            style={{ zIndex: 'var(--z-confirm-modal)' }}
            onClick={handleBackdropClick}
            role="dialog"
            aria-modal="true"
        >
            <div className="absolute inset-0 bg-[var(--bg-primary)]/40 backdrop-blur-sm transition-opacity" />

            <div
                ref={modalRef}
                onClick={(e) => e.stopPropagation()}
                className="relative bg-[var(--bg-primary)] rounded-2xl shadow-xl w-full max-w-sm overflow-hidden transform transition-all animate-in fade-in zoom-in-95 duration-200 p-6 border border-[var(--border-primary)]"
            >
                <div className="flex justify-between items-start mb-4">
                    <div className="p-3 rounded-full flex-shrink-0 bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)]">
                        <Pencil size={24} />
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="gnosi-close-btn"
                        aria-label={t('common.close', "Close")}
                    >
                        <X />
                    </button>
                </div>

                <div>
                    <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                        {resolvedTitle}
                    </h3>
                    {message && (
                        <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
                            {message}
                        </p>
                    )}
                    {label && (
                        <label className="block text-xs font-medium text-[var(--text-tertiary)] mb-1">
                            {label}
                        </label>
                    )}
                    <input
                        ref={inputRef}
                        type={inputType}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
                        }}
                        placeholder={placeholder}
                        disabled={isSubmitting}
                        className="gnosi-input w-full mb-6"
                    />
                </div>

                <div className="flex items-center justify-end gap-3 mt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="px-4 py-2 font-medium text-[var(--text-secondary)] border border-[var(--border-primary)] rounded-lg hover:bg-[var(--bg-secondary)] transition-colors focus:ring-2 focus:ring-[var(--border-primary)] outline-none"
                    >
                        {resolvedCancelText}
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isSubmitting || (required && !(value || '').trim())}
                        className="px-4 py-2 font-medium rounded-lg text-white shadow-sm transition-colors focus:ring-2 focus:ring-offset-1 outline-none bg-[var(--gnosi-blue)] hover:opacity-90 focus:ring-[var(--gnosi-blue)]/50 disabled:opacity-50"
                    >
                        {isSubmitting ? '...' : resolvedConfirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PromptModal;
