import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AlertCircle, X, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalKeyboard } from '../hooks/useModalKeyboard';

export const ConfirmModal = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText,
    cancelText,
    isDestructive = true
}) => {
    const { t } = useTranslation();
    // Localized fallbacks: callers may omit these props; default to i18n instead
    // of hardcoded Catalan so the dialog is never partially untranslated. `??`
    // (not `||`) so an explicit empty string from a caller is respected.
    const resolvedTitle = title ?? t('common.confirm_action', 'Confirmar acció');
    const resolvedMessage = message ?? t('common.confirm_action_msg', "N'estàs segur que vols procedir amb aquesta acció?");
    const resolvedConfirmText = confirmText ?? t('common.confirm', 'Confirmar');
    const resolvedCancelText = cancelText ?? t('common.cancel', 'Cancel·lar');
    const modalRef = useRef(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleConfirm = useCallback(async () => {
        if (isSubmitting) return;
        try {
            setIsSubmitting(true);
            await onConfirm();
        } catch (err) {
            console.error('[ConfirmModal] Error en onConfirm:', err);
        } finally {
            setIsSubmitting(false);
        }
    }, [isSubmitting, onConfirm]);

    // Rich keyboard logic (Esc, Enter→confirm, Tab focus-trap, restoration
    // of focus on close): now centralized in the canonical hook. Esc does not abort an
    // ongoing destructive operation (isSubmitting guard), same as the backdrop.
    useModalKeyboard({
        isOpen,
        onClose: () => { if (!isSubmitting) onClose(); },
        onConfirm: handleConfirm,
        confirmDisabled: isSubmitting,
        containerRef: modalRef,
        trapFocus: true,
    });

    useEffect(() => {
        if (!isOpen) {
            setIsSubmitting(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleBackdropClick = () => {
        if (isSubmitting) return; // never abort an in-flight destructive op
        onClose();
    };

    return (
        <div
            className="fixed inset-0 flex items-center justify-center"
            style={{ zIndex: 99999 }}
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
                    <div className={`p-3 rounded-full flex-shrink-0 ${isDestructive ? 'bg-[var(--bg-secondary)] text-[var(--status-error)]' : 'bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)]'}`}>
                        {isDestructive ? <AlertCircle size={24} /> : <Check size={24} />}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="gnosi-close-btn"
                        aria-label={t('common.close', 'Tanca')}
                    >
                        <X />
                    </button>
                </div>

                <div>
                    <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                        {resolvedTitle}
                    </h3>
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
                        {resolvedMessage}
                    </p>
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
                        data-autofocus="true"
                        type="button"
                        onClick={handleConfirm}
                        disabled={isSubmitting}
                        className={`px-4 py-2 font-medium rounded-lg text-white shadow-sm transition-colors focus:ring-2 focus:ring-offset-1 outline-none ${isDestructive
                            ? 'bg-[var(--status-error)] hover:opacity-90 focus:ring-[var(--status-error)]/50'
                            : 'bg-[var(--gnosi-blue)] hover:opacity-90 focus:ring-[var(--gnosi-blue)]/50'
                            }`}
                    >
                        {isSubmitting ? '...' : resolvedConfirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;
